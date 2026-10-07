import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { McpHttpClient, toolPayload } from "./mcp.mjs";
import { renderTunnelProfile } from "./render.mjs";
import { writePrivateFile } from "./fsutil.mjs";

/** Tools a client approved for read access may call without changing anything. */
export const READ_ONLY_PROBE = { name: "t3_project_list", arguments: { limit: 5 } };

/**
 * Exercises an MCP endpoint the way a ChatGPT connector would: initialize,
 * list the full catalog, then make one read-only call.
 */
export async function probeMcp({ url, headers = {}, probe = READ_ONLY_PROBE }) {
  const client = new McpHttpClient({ url, headers });
  try {
    const init = await client.initialize();
    const tools = await client.listTools();
    const result = await client.callTool(probe.name, probe.arguments);
    return {
      protocolVersion: init.protocolVersion,
      serverInfo: init.serverInfo,
      sessionIssued: client.sessionId !== undefined,
      toolCount: tools.length,
      toolNames: tools.map((tool) => tool.name).sort(),
      readOnlyTools: tools.filter((tool) => tool.annotations?.readOnlyHint === true).length,
      probe: { name: probe.name, isError: result.isError === true, payload: toolPayload(result) },
    };
  } finally {
    await client.close();
  }
}

/**
 * Runs the stock tunnel-client's local in-memory control plane (`dev proxy`)
 * with a profile shaped exactly like the production one and calls `use` with
 * its MCP ingress URL. Requests sent there carry no Authorization header, so a
 * successful call proves tunnel-client forwards to native T3 and injects the
 * credential itself. Only the OpenAI-hosted control plane is replaced.
 */
export async function withDevProxy(
  { tunnelClientBin, t3McpUrl, t3AuthorizationFile, readinessTimeout = "60s" },
  use,
) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "t3mcp-devproxy-"));
  const tunnelId = "tunnel_22222222222222222222222222222222";
  const profileFile = path.join(work, "profile.yaml");
  const keyFile = path.join(work, "dummy-runtime-key");
  const urlFile = path.join(work, "proxy.json");
  writePrivateFile(keyFile, "sk-local-dev-proxy-placeholder");
  writePrivateFile(
    profileFile,
    renderTunnelProfile({
      tunnelId,
      runtimeKeyFile: keyFile,
      t3McpUrl,
      t3AuthorizationFile,
      healthAddr: "127.0.0.1:0",
    }),
  );
  const child = spawn(
    tunnelClientBin,
    [
      "dev",
      "proxy",
      "--profile-file",
      profileFile,
      "--tunnel-id",
      tunnelId,
      "--url-file",
      urlFile,
      "--readiness-timeout",
      readinessTimeout,
      "--response-timeout",
      "120s",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    const deadline = Date.now() + 90_000;
    let connection;
    while (!connection) {
      if (child.exitCode !== null) {
        throw new Error(`tunnel-client dev proxy exited (${child.exitCode}):\n${output.slice(-2000)}`);
      }
      if (Date.now() > deadline) throw new Error(`dev proxy not ready:\n${output.slice(-2000)}`);
      if (fs.existsSync(urlFile)) {
        try {
          connection = JSON.parse(fs.readFileSync(urlFile, "utf8"));
        } catch {}
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const mcpUrl = connection.mcp_url ?? connection.mcpUrl ?? connection.url;
    if (!mcpUrl) throw new Error(`dev proxy did not report an MCP URL: ${JSON.stringify(connection)}`);
    return await use(mcpUrl);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export function probeThroughDevProxy({ probe, ...options }) {
  return withDevProxy(options, async (url) => ({ ...(await probeMcp({ url, probe })), viaUrl: url }));
}
