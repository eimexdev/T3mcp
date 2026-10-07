#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  DEFAULT_HEALTH_ADDR,
  DEFAULT_T3_URL,
  EXPIRY_SERVICE_NAME,
  EXPIRY_TIMER_NAME,
  SERVICE_NAME,
  resolvePaths,
} from "../src/paths.mjs";
import { ensurePrivateDir, readJsonFile, writeJsonFile, writePrivateFile } from "../src/fsutil.mjs";
import {
  DEFAULT_CLIENT_NAME,
  daysUntil,
  loadAuthorizationHeader,
  obtainCredential,
  saveCredential,
  verifyCredential,
} from "../src/credential.mjs";
import { ACCESS_LEVELS } from "../src/oauth.mjs";
import { assertTunnelId, renderExpiryCheck, renderTunnelProfile, renderTunnelService } from "../src/render.mjs";
import { probeMcp, probeThroughDevProxy, withDevProxy } from "../src/checks.mjs";
import { LaunchLedger, reconcileLaunch, validateLifecycle } from "../src/lifecycle.mjs";
import { McpHttpClient } from "../src/mcp.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = resolvePaths();
const log = (message = "") => process.stderr.write(`${message}\n`);

const USAGE = `t3mcp: connect a personal ChatGPT plugin to native T3 Code MCP
through OpenAI Secure MCP Tunnel.

Commands:
  install-tunnel-client [vX.Y.Z]   Download and verify the stock tunnel-client.
  auth                             Obtain a dedicated T3 MCP credential (OAuth approval).
      --approval browser|pairing-code|mint-pairing-code   (default: browser)
      --access <level>             Required for pairing-code approvals:
                                   ${ACCESS_LEVELS.join(", ")}
      --t3-url <url>               T3 origin (default: settings or ${DEFAULT_T3_URL})
      --client-name <name>         Shown in T3 Connections (default: "${DEFAULT_CLIENT_NAME}")
      --callback-port <port>       Fixed loopback callback port (default: random)
      --open                       Open the approval URL with xdg-open.
      --revoke-previous            Revoke the credential this one replaces.
      --no-restart                 Do not restart the tunnel service afterwards.
  configure --tunnel-id <id>       Write the tunnel-client profile.
      --runtime-key-stdin          Read the OpenAI tunnel runtime key from stdin.
      --t3-url <url>  --health-addr <host:port>
  check [--via-dev-proxy] [--json] Verify the credential against native T3 /mcp,
                                   or through a local tunnel-client dev proxy.
  validate-lifecycle [--via-dev-proxy] [--model-json <json>]
                                   Launch, wait, read, follow up, and interrupt a
                                   harmless thread in T3's Scratch workspace.
  reconcile                        Resolve launches whose outcome was not recorded.
  doctor                           Run tunnel-client doctor on the profile.
  service install|uninstall|start|stop|restart|status|logs
  status [--json]                  Credential expiry, T3, and tunnel health.
  expiry-check --warn-days <n>     Log and notify when renewal is due (used by the timer).
`;

function settings() {
  return readJsonFile(paths.settingsFile) ?? {};
}

function t3UrlFrom(values) {
  return (values["t3-url"] ?? settings().t3Url ?? DEFAULT_T3_URL).replace(/\/+$/, "");
}

const mcpUrlFor = (t3Url) => `${t3Url}/mcp`;

function systemctl(...args) {
  return spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
}

function serviceActive(name = SERVICE_NAME) {
  return systemctl("is-active", "--quiet", name).status === 0;
}

async function readSecretFromStdin(prompt) {
  if (process.stdin.isTTY) {
    process.stderr.write(prompt);
    process.stdin.setRawMode(true);
    let value = "";
    for await (const chunk of process.stdin) {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stderr.write("\n");
          return value.trim();
        }
        if (char === "\u0003") process.exit(130);
        if (char === "\u007f") value = value.slice(0, -1);
        else value += char;
      }
    }
    return value.trim();
  }
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line.trim();
  }
  return "";
}

async function cmdAuth(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "t3-url": { type: "string" },
      approval: { type: "string", default: "browser" },
      access: { type: "string" },
      "client-name": { type: "string", default: DEFAULT_CLIENT_NAME },
      "callback-port": { type: "string" },
      "t3-bin": { type: "string", default: "t3" },
      "t3-base-dir": { type: "string" },
      open: { type: "boolean", default: false },
      "revoke-previous": { type: "boolean", default: false },
      "no-restart": { type: "boolean", default: false },
    },
  });
  const approval = values.approval;
  if (!["browser", "pairing-code", "mint-pairing-code"].includes(approval)) {
    throw new Error("--approval must be browser, pairing-code, or mint-pairing-code.");
  }
  if (approval !== "browser" && !ACCESS_LEVELS.includes(values.access ?? "")) {
    throw new Error(`Pairing-code approval needs --access: ${ACCESS_LEVELS.join(", ")}`);
  }
  if (approval === "browser" && values.access) {
    throw new Error("With browser approval, choose the access level on T3's approval page.");
  }
  const t3Url = t3UrlFrom(values);
  const credential = await obtainCredential({
    t3Url,
    clientName: values["client-name"],
    approval,
    access: values.access,
    t3Bin: values["t3-bin"],
    t3BaseDir: values["t3-base-dir"],
    callbackPort: values["callback-port"] ? Number(values["callback-port"]) : 0,
    openBrowser: values.open,
    log,
  });
  const authorization = `Bearer ${credential.token}`;
  const verified = await verifyCredential({ mcpUrl: mcpUrlFor(t3Url), authorization });
  const previous = saveCredential(paths, credential);
  writeJsonFile(paths.settingsFile, { ...settings(), t3Url });

  const { metadata } = credential;
  log(`Saved T3 MCP credential to ${paths.t3AuthorizationFile} (mode 600).`);
  log(`  client: ${metadata.clientName}   scope: ${metadata.scope}   access: ${metadata.access}`);
  log(`  expires: ${metadata.expiresAt}   session: ${metadata.sessionId ?? "unknown"}`);
  log(`  verified: ${verified.serverInfo?.name} ${verified.serverInfo?.version}, protocol ${verified.protocolVersion}, ${verified.tools.length} tools`);

  if (previous?.sessionId && previous.sessionId !== metadata.sessionId) {
    if (values["revoke-previous"]) {
      const args = ["auth", "session", "revoke", previous.sessionId];
      if (values["t3-base-dir"]) args.push("--base-dir", values["t3-base-dir"]);
      execFileSync(values["t3-bin"], args, { stdio: ["ignore", "ignore", "inherit"] });
      log(`Revoked the previous credential (session ${previous.sessionId}).`);
    } else {
      log(`The previous credential (session ${previous.sessionId}) stays valid until ${previous.expiresAt}.`);
      log(`Revoke it in T3 Settings > Connections, or: t3 auth session revoke ${previous.sessionId}`);
    }
  }
  if (!values["no-restart"] && serviceActive()) {
    systemctl("restart", SERVICE_NAME);
    log(`Restarted ${SERVICE_NAME} so tunnel-client reads the new credential.`);
  }
}

async function cmdConfigure(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "tunnel-id": { type: "string" },
      "runtime-key-stdin": { type: "boolean", default: false },
      "t3-url": { type: "string" },
      "health-addr": { type: "string" },
    },
  });
  const current = settings();
  const tunnelId = values["tunnel-id"] ?? current.tunnelId;
  assertTunnelId(tunnelId);
  const t3Url = t3UrlFrom(values);
  const healthAddr = values["health-addr"] ?? current.healthAddr ?? DEFAULT_HEALTH_ADDR;
  ensurePrivateDir(paths.configDir);

  if (values["runtime-key-stdin"]) {
    const key = await readSecretFromStdin("OpenAI tunnel runtime API key (input hidden): ");
    if (!/^sk-[\w-]{20,}$/.test(key)) throw new Error("That does not look like an OpenAI API key (sk-...).");
    writePrivateFile(paths.runtimeKeyFile, key);
    log(`Saved the runtime key to ${paths.runtimeKeyFile} (mode 600).`);
  } else if (!fs.existsSync(paths.runtimeKeyFile)) {
    throw new Error(`No runtime key at ${paths.runtimeKeyFile}. Re-run with --runtime-key-stdin.`);
  }

  writePrivateFile(
    paths.tunnelProfileFile,
    renderTunnelProfile({
      tunnelId,
      runtimeKeyFile: paths.runtimeKeyFile,
      t3McpUrl: mcpUrlFor(t3Url),
      t3AuthorizationFile: paths.t3AuthorizationFile,
      healthAddr,
    }),
  );
  writeJsonFile(paths.settingsFile, { ...current, tunnelId, t3Url, healthAddr });
  log(`Wrote ${paths.tunnelProfileFile}.`);
  if (serviceActive()) {
    systemctl("restart", SERVICE_NAME);
    log(`Restarted ${SERVICE_NAME}.`);
  }
}

function printCheck(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  log(`server: ${result.serverInfo?.name} ${result.serverInfo?.version}`);
  log(`protocol: ${result.protocolVersion}   session id issued: ${result.sessionIssued}`);
  log(`tools: ${result.toolCount} (${result.readOnlyTools} annotated read-only)`);
  const projects = result.probe.payload?.projects;
  log(
    `read-only call ${result.probe.name}: ${result.probe.isError ? "ERROR" : "ok"}` +
      (Array.isArray(projects) ? `, ${projects.length} project(s) returned` : ""),
  );
  if (result.viaUrl) log(`via: tunnel-client dev proxy ingress ${result.viaUrl} (no client-side Authorization header)`);
}

async function cmdCheck(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "via-dev-proxy": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      "t3-url": { type: "string" },
    },
  });
  const t3Url = t3UrlFrom(values);
  let result;
  if (values["via-dev-proxy"]) {
    loadAuthorizationHeader(paths);
    result = await probeThroughDevProxy({
      tunnelClientBin: paths.tunnelClientBin,
      t3McpUrl: mcpUrlFor(t3Url),
      t3AuthorizationFile: paths.t3AuthorizationFile,
    });
  } else {
    result = await probeMcp({
      url: mcpUrlFor(t3Url),
      headers: { authorization: loadAuthorizationHeader(paths) },
    });
  }
  printCheck(result, values.json);
  if (result.probe.isError) process.exitCode = 1;
}

async function cmdValidateLifecycle(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "via-dev-proxy": { type: "boolean", default: false },
      "model-json": { type: "string" },
      "t3-url": { type: "string" },
    },
  });
  const t3Url = t3UrlFrom(values);
  const ledger = new LaunchLedger(paths.launchLedgerFile);
  const modelSelection = values["model-json"] ? JSON.parse(values["model-json"]) : undefined;
  const authorization = loadAuthorizationHeader(paths);
  const run = (mcpUrl, headers) => validateLifecycle({ mcpUrl, headers, ledger, modelSelection, log });
  const report = values["via-dev-proxy"]
    ? await withDevProxy(
        {
          tunnelClientBin: paths.tunnelClientBin,
          t3McpUrl: mcpUrlFor(t3Url),
          t3AuthorizationFile: paths.t3AuthorizationFile,
        },
        // tunnel-client injects the credential; send none from here.
        (url) => run(url, {}),
      )
    : await run(mcpUrlFor(t3Url), { authorization });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

async function cmdReconcile() {
  const ledger = new LaunchLedger(paths.launchLedgerFile);
  const pending = ledger.unresolved();
  if (pending.length === 0) {
    log("No unresolved launches.");
    return;
  }
  const client = new McpHttpClient({
    url: mcpUrlFor(t3UrlFrom({})),
    headers: { authorization: loadAuthorizationHeader(paths) },
  });
  try {
    await client.initialize();
    for (const entry of pending) {
      const threadIds = await reconcileLaunch(client, entry.marker);
      ledger.append({ ref: entry.ref, marker: entry.marker, stage: "reconciled", threadIds });
      log(`${entry.marker}: ${threadIds.length ? `launched as ${threadIds.join(", ")}` : "no thread found; safe to launch again"}`);
    }
  } finally {
    await client.close();
  }
}

function cmdDoctor() {
  const run = spawnSync(paths.tunnelClientBin, ["doctor", "--profile-file", paths.tunnelProfileFile, "--explain"], {
    stdio: "inherit",
  });
  process.exitCode = run.status ?? 1;
}

function installUnits() {
  if (!fs.existsSync(paths.tunnelProfileFile)) throw new Error("Run `t3mcp configure` first.");
  if (!fs.existsSync(paths.tunnelClientBin)) throw new Error("Run `t3mcp install-tunnel-client` first.");
  fs.mkdirSync(paths.systemdUserDir, { recursive: true });
  fs.writeFileSync(
    path.join(paths.systemdUserDir, SERVICE_NAME),
    renderTunnelService({ tunnelClientBin: paths.tunnelClientBin, profileFile: paths.tunnelProfileFile }),
  );
  const expiry = renderExpiryCheck({
    nodeBin: process.execPath,
    cliPath: path.join(repoRoot, "bin", "t3mcp.mjs"),
    warnDays: 7,
  });
  fs.writeFileSync(path.join(paths.systemdUserDir, EXPIRY_SERVICE_NAME), expiry.service);
  fs.writeFileSync(path.join(paths.systemdUserDir, EXPIRY_TIMER_NAME), expiry.timer);
  systemctl("daemon-reload");
  for (const unit of [SERVICE_NAME, EXPIRY_TIMER_NAME]) {
    const enabled = systemctl("enable", "--now", unit);
    if (enabled.status !== 0) throw new Error(`systemctl enable ${unit}: ${enabled.stderr}`);
  }
  log(`Installed and started ${SERVICE_NAME} and ${EXPIRY_TIMER_NAME}.`);
  const linger = spawnSync("loginctl", ["show-user", process.env.USER ?? "", "-p", "Linger"], { encoding: "utf8" });
  if (!linger.stdout.includes("Linger=yes")) {
    log("Note: user lingering is off, so the tunnel stops when you log out. Enable it with:");
    log("  sudo loginctl enable-linger $USER");
  }
}

function cmdService([action = "status"]) {
  switch (action) {
    case "install":
      installUnits();
      return;
    case "uninstall":
      systemctl("disable", "--now", SERVICE_NAME, EXPIRY_TIMER_NAME);
      for (const unit of [SERVICE_NAME, EXPIRY_SERVICE_NAME, EXPIRY_TIMER_NAME]) {
        fs.rmSync(path.join(paths.systemdUserDir, unit), { force: true });
      }
      systemctl("daemon-reload");
      log("Removed the T3mcp units. Configuration and secrets were left in place.");
      return;
    case "start":
    case "stop":
    case "restart":
      process.exitCode = systemctl(action, SERVICE_NAME).status ?? 1;
      return;
    case "status":
      spawnSync("systemctl", ["--user", "status", "--no-pager", SERVICE_NAME, EXPIRY_TIMER_NAME], { stdio: "inherit" });
      return;
    case "logs":
      spawnSync("journalctl", ["--user", "-u", SERVICE_NAME, "-n", "200", "--no-pager"], { stdio: "inherit" });
      return;
    default:
      throw new Error(`Unknown service action: ${action}`);
  }
}

async function healthOf(healthAddr) {
  const get = async (route) => {
    try {
      const response = await fetch(`http://${healthAddr}${route}`, { signal: AbortSignal.timeout(3_000) });
      return response.status;
    } catch {
      return "unreachable";
    }
  };
  return { healthz: await get("/healthz"), readyz: await get("/readyz") };
}

async function cmdStatus(argv) {
  const { values } = parseArgs({ args: argv, options: { json: { type: "boolean", default: false } } });
  const current = settings();
  const t3Url = current.t3Url ?? DEFAULT_T3_URL;
  const credential = readJsonFile(paths.credentialFile);
  const status = {
    t3Url,
    tunnelId: current.tunnelId ?? null,
    credential: credential
      ? {
          clientName: credential.clientName,
          access: credential.access,
          expiresAt: credential.expiresAt,
          daysLeft: Number(daysUntil(credential.expiresAt).toFixed(1)),
        }
      : null,
    credentialAccepted: null,
    service: systemctl("is-active", SERVICE_NAME).stdout.trim() || "unknown",
    tunnelHealth: current.healthAddr ? await healthOf(current.healthAddr) : null,
  };
  if (credential) {
    try {
      const verified = await verifyCredential({
        mcpUrl: mcpUrlFor(t3Url),
        authorization: loadAuthorizationHeader(paths),
      });
      status.credentialAccepted = true;
      status.toolCount = verified.tools.length;
    } catch (error) {
      status.credentialAccepted = false;
      status.credentialError = error.message;
    }
  }
  if (values.json) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    return;
  }
  log(`T3: ${t3Url}`);
  log(
    status.credential
      ? `credential: ${status.credential.clientName}, ${status.credential.access}, expires ${status.credential.expiresAt} (${status.credential.daysLeft} days)`
      : "credential: none (run t3mcp auth)",
  );
  if (status.credentialAccepted !== null) {
    log(`credential accepted by T3: ${status.credentialAccepted}${status.toolCount ? ` (${status.toolCount} tools)` : ""}${status.credentialError ? ` - ${status.credentialError}` : ""}`);
  }
  log(`tunnel: ${status.tunnelId ?? "not configured"}   service: ${status.service}`);
  if (status.tunnelHealth) log(`tunnel-client health: /healthz ${status.tunnelHealth.healthz}, /readyz ${status.tunnelHealth.readyz}`);
}

function cmdExpiryCheck(argv) {
  const { values } = parseArgs({ args: argv, options: { "warn-days": { type: "string", default: "7" } } });
  const credential = readJsonFile(paths.credentialFile);
  if (!credential) {
    log("t3mcp: no T3 MCP credential recorded; run `t3mcp auth`.");
    process.exitCode = 1;
    return;
  }
  const days = daysUntil(credential.expiresAt);
  if (days > Number(values["warn-days"])) {
    log(`t3mcp: T3 MCP credential valid for ${days.toFixed(1)} more days.`);
    return;
  }
  const message =
    days <= 0
      ? "The T3 MCP credential for ChatGPT has expired. Run `t3mcp auth` to renew it."
      : `The T3 MCP credential for ChatGPT expires in ${days.toFixed(1)} days. Run \`t3mcp auth\` to renew it.`;
  log(`t3mcp: WARNING ${message}`);
  spawnSync("notify-send", ["--app-name=T3mcp", "T3 Code ChatGPT tunnel", message], { stdio: "ignore" });
  process.exitCode = days <= 0 ? 2 : 0;
}

function cmdInstallTunnelClient([version]) {
  const run = spawnSync(path.join(repoRoot, "scripts", "install-tunnel-client.sh"), version ? [version] : [], {
    stdio: "inherit",
  });
  process.exitCode = run.status ?? 1;
}

const [command, ...rest] = process.argv.slice(2);
const commands = {
  auth: cmdAuth,
  configure: cmdConfigure,
  check: cmdCheck,
  doctor: cmdDoctor,
  "validate-lifecycle": cmdValidateLifecycle,
  reconcile: cmdReconcile,
  service: cmdService,
  status: cmdStatus,
  "expiry-check": cmdExpiryCheck,
  "install-tunnel-client": cmdInstallTunnelClient,
};

if (!command || command === "help" || command === "--help" || command === "-h") {
  process.stdout.write(USAGE);
} else if (!commands[command]) {
  log(`Unknown command: ${command}\n`);
  process.stdout.write(USAGE);
  process.exitCode = 2;
} else {
  try {
    await commands[command](rest);
  } catch (error) {
    log(`t3mcp ${command}: ${error.message}`);
    process.exitCode = 1;
  }
}
