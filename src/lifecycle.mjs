import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { McpHttpClient, toolPayload } from "./mcp.mjs";

/**
 * An append-only record of launches. `t3_thread_launch` has no idempotency
 * key, so a launch whose response was lost is recorded as uncertain and
 * reconciled by its unique marker before anything is retried.
 */
export class LaunchLedger {
  constructor(file) {
    this.file = file;
  }

  append(entry) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    fs.appendFileSync(this.file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, {
      mode: 0o600,
    });
  }

  entries() {
    if (!fs.existsSync(this.file)) return [];
    return fs
      .readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  /** Launch refs with an intent but no accepted or reconciled outcome. */
  unresolved() {
    const byRef = new Map();
    for (const entry of this.entries()) byRef.set(entry.ref, entry);
    return [...byRef.values()].filter((entry) => entry.stage === "intent" || entry.stage === "uncertain");
  }
}

/** T3 answered the call with a tool error: the request definitely did not take effect as asked. */
export class ToolRejected extends Error {}

async function call(client, name, args, options) {
  const result = await client.callTool(name, args, options);
  const payload = toolPayload(result);
  if (result.isError) {
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new ToolRejected(`${name} failed: ${message}`);
  }
  return payload;
}

/** Finds threads whose content carries `marker`, across every project. */
export async function reconcileLaunch(client, marker) {
  const found = await call(client, "t3_thread_search", { query: marker, limit: 10 });
  return [...new Set((found?.matches ?? []).map((match) => match.threadId))];
}

/** Bounded waiting: short native waits, repeated up to a total budget. */
async function waitForRun(client, { threadId, runId, totalMs, stepMs = 30_000, log }) {
  const deadline = Date.now() + totalMs;
  for (;;) {
    const remaining = deadline - Date.now();
    const result = await call(
      client,
      "t3_thread_wait",
      { threadId, runId, timeoutMs: Math.max(1_000, Math.min(stepMs, remaining)) },
      { timeoutMs: stepMs + 30_000 },
    );
    log(`  wait: run ${result.runId} status=${result.status} timedOut=${result.timedOut}`);
    if (!result.timedOut || Date.now() >= deadline) return result;
  }
}

async function assistantTexts(client, threadId) {
  const read = await call(client, "t3_thread_read", { threadId, view: "messages", limit: 50 });
  const items = read?.items ?? [];
  return {
    read,
    texts: items
      .filter((item) => String(item.type ?? item.role ?? "").includes("assistant"))
      .map((item) => item.text ?? item.content ?? ""),
  };
}

/**
 * Proves the remote-control lifecycle with an external MCP credential in a
 * disposable Scratch workspace: launch, bounded wait, read, follow-up, and
 * interruption. Returns every thread and run ID it touched.
 */
export async function validateLifecycle({
  mcpUrl,
  headers = {},
  ledger,
  modelSelection,
  log = (message) => process.stderr.write(`${message}\n`),
}) {
  const client = new McpHttpClient({ url: mcpUrl, headers, timeoutMs: 120_000 });
  const ref = crypto.randomUUID();
  const marker = `T3MCP-${ref.slice(0, 8)}`;
  const report = { ref, marker, steps: [] };
  try {
    await client.initialize({ name: "t3mcp-validate", version: "0.1.0" });

    const pending = ledger.unresolved();
    if (pending.length > 0) {
      throw new Error(
        `Unresolved launches in ${ledger.file}: ${pending.map((entry) => entry.marker).join(", ")}. ` +
          "Reconcile them (t3mcp reconcile) before launching again.",
      );
    }

    // 1. Launch: record intent first, then the IDs, or uncertainty.
    const title = `T3mcp validation ${marker}`;
    ledger.append({ ref, marker, title, stage: "intent" });
    let launch;
    try {
      launch = await call(
        client,
        "t3_thread_launch",
        {
          scratch: true,
          title,
          message: `This is a connectivity test. Do not use any tools. Reply with exactly: ${marker}-LAUNCH-OK`,
          ...(modelSelection ? { modelSelection } : {}),
        },
        { timeoutMs: 120_000 },
      );
    } catch (error) {
      if (error instanceof ToolRejected) {
        ledger.append({ ref, marker, stage: "rejected", error: error.message });
        throw error;
      }
      // No answer (timeout, dropped connection): the thread may exist. Never
      // retry blindly; look for the marker first.
      ledger.append({ ref, marker, stage: "uncertain", error: error.message });
      const threads = await reconcileLaunch(client, marker).catch(() => []);
      ledger.append({ ref, marker, stage: threads.length ? "reconciled" : "uncertain", threadIds: threads });
      throw new Error(`Launch outcome uncertain (${error.message}); matching threads: ${threads.join(", ") || "none"}`);
    }
    ledger.append({ ref, marker, stage: "accepted", threadId: launch.threadId, runId: launch.runId, projectId: launch.projectId });
    report.threadId = launch.threadId;
    report.projectId = launch.projectId;
    report.model = launch.modelSelection;
    report.steps.push({ step: "launch", threadId: launch.threadId, runId: launch.runId, status: launch.status });
    log(`launch: thread ${launch.threadId} run ${launch.runId} status=${launch.status}`);

    // 2. Bounded wait and read.
    const first = await waitForRun(client, { threadId: launch.threadId, runId: launch.runId ?? undefined, totalMs: 5 * 60_000, log });
    let { texts } = await assistantTexts(client, launch.threadId);
    const launchOk = texts.some((text) => text.includes(`${marker}-LAUNCH-OK`));
    report.steps.push({ step: "wait+read", runId: first.runId, status: first.status, markerFound: launchOk });
    log(`read: launch marker ${launchOk ? "found" : "NOT found"}`);

    // 3. Follow-up with a retry-safe clientRequestId.
    const followUp = await call(client, "t3_thread_send", {
      threadId: launch.threadId,
      message: `Second connectivity check. Do not use any tools. Reply with exactly: ${marker}-FOLLOWUP-OK`,
      mode: "queue",
      clientRequestId: `${ref}-followup`,
    });
    log(`follow-up: run ${followUp.runId} delivery=${followUp.delivery} status=${followUp.status}`);
    const second = await waitForRun(client, { threadId: launch.threadId, runId: followUp.runId, totalMs: 5 * 60_000, log });
    ({ texts } = await assistantTexts(client, launch.threadId));
    const followOk = texts.some((text) => text.includes(`${marker}-FOLLOWUP-OK`));
    report.steps.push({ step: "follow-up", runId: followUp.runId, status: second.status, markerFound: followOk });
    log(`read: follow-up marker ${followOk ? "found" : "NOT found"}`);

    // 4. Interruption of a deliberately long turn.
    const longTurn = await call(client, "t3_thread_send", {
      threadId: launch.threadId,
      message:
        "Interruption test. Do not use any tools. Write the numbers from 1 to 3000 in words, one per line, " +
        "with no other text.",
      mode: "queue",
      clientRequestId: `${ref}-long`,
    });
    log(`long turn: run ${longTurn.runId} status=${longTurn.status}`);
    // Let the provider start streaming before interrupting.
    await waitForRun(client, { threadId: launch.threadId, runId: longTurn.runId, totalMs: 8_000, stepMs: 8_000, log });
    const interrupt = await call(client, "t3_thread_interrupt", {
      threadId: launch.threadId,
      runId: longTurn.runId,
      reason: "T3mcp lifecycle validation",
      clientRequestId: `${ref}-interrupt`,
    });
    log(`interrupt: status=${interrupt.status}`);
    const third = await waitForRun(client, { threadId: launch.threadId, runId: longTurn.runId, totalMs: 2 * 60_000, log });
    report.steps.push({ step: "interrupt", runId: longTurn.runId, requested: interrupt.status, finalStatus: third.status });

    report.ok =
      launchOk &&
      followOk &&
      first.status === "completed" &&
      second.status === "completed" &&
      third.status === "interrupted";
    return report;
  } finally {
    await client.close();
  }
}
