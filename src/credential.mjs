import fs from "node:fs";
import readline from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  approveWithPairingCode,
  authorizationParams,
  authorizationUrl,
  createPkce,
  discover,
  exchangeCode,
  parseRedirect,
  randomState,
  registerClient,
  sessionClaims,
  startCallbackServer,
} from "./oauth.mjs";
import { McpHttpClient } from "./mcp.mjs";
import { readJsonFile, readPrivateFile, writeJsonFile, writePrivateFile } from "./fsutil.mjs";

const execFileAsync = promisify(execFile);

export const DEFAULT_CLIENT_NAME = "T3 Code (ChatGPT tunnel)";

/**
 * Mints a short-lived one-time pairing code with the local `t3` CLI. The code
 * is passed straight to the approval API and never printed or stored.
 */
export async function mintPairingCode({ t3Bin = "t3", baseDir, label }) {
  const args = ["auth", "pairing", "create", "--ttl", "2m", "--label", label, "--json"];
  if (baseDir) args.push("--base-dir", baseDir);
  const { stdout } = await execFileAsync(t3Bin, args, { timeout: 60_000 });
  // The JSON document may be pretty-printed after log lines.
  const start = stdout.search(/^\{/m);
  let issued;
  try {
    issued = start >= 0 ? JSON.parse(stdout.slice(start)) : undefined;
  } catch {
    issued = undefined;
  }
  if (!issued?.credential) throw new Error("`t3 auth pairing create` returned no pairing code.");
  return { id: issued.id, code: issued.credential };
}

async function revokePairingCode({ t3Bin = "t3", baseDir, id }) {
  const args = ["auth", "pairing", "revoke", id];
  if (baseDir) args.push("--base-dir", baseDir);
  try {
    await execFileAsync(t3Bin, args, { timeout: 60_000 });
  } catch {}
}

async function readLineFromStdin() {
  const rl = readline.createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line.trim();
  }
  return "";
}

/**
 * Waits for the browser to reach the loopback callback. When stdin is a
 * terminal, also accepts the redirect URL pasted from a browser on another
 * machine, where the loopback address cannot reach this process.
 */
async function waitForRedirect(callback, { timeoutMs, log }) {
  const waits = [callback.result];
  let rl;
  if (process.stdin.isTTY) {
    log(
      "If your browser is on another machine, the final page will not load. Copy its full address\n" +
        "(starting with the callback URL above) and paste it here, then press Enter.",
    );
    rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    waits.push(
      new Promise((resolve) => {
        rl.on("line", (line) => {
          if (line.trim().startsWith("http")) resolve(line.trim());
        });
      }),
    );
  }
  let timer;
  waits.push(
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out waiting for approval.")), timeoutMs);
    }),
  );
  try {
    return await Promise.race(waits);
  } finally {
    clearTimeout(timer);
    rl?.close();
  }
}

/**
 * Runs the T3 MCP OAuth flow and returns the issued token and its metadata.
 *
 * approval: "browser" (owner approves on T3's page and picks the access level),
 * "pairing-code" (code read from stdin, access given explicitly), or
 * "mint-pairing-code" (code minted with the local t3 CLI, access explicit).
 */
export async function obtainCredential({
  t3Url,
  clientName = DEFAULT_CLIENT_NAME,
  approval = "browser",
  access,
  t3Bin,
  t3BaseDir,
  callbackPort = 0,
  timeoutMs = 10 * 60_000,
  openBrowser = false,
  log = (message) => process.stderr.write(`${message}\n`),
}) {
  const { resource, issuer, metadata } = await discover(t3Url);
  const callback = await startCallbackServer({ port: callbackPort });
  try {
    const client = await registerClient(metadata, { clientName, redirectUri: callback.redirectUri });
    const pkce = createPkce();
    const state = randomState();
    const params = authorizationParams({
      clientId: client.client_id,
      redirectUri: callback.redirectUri,
      challenge: pkce.challenge,
      state,
      resource,
    });

    let redirect;
    if (approval === "browser") {
      const url = authorizationUrl(metadata, params);
      log(`Open this URL in a browser signed in to T3 Code as the owner, choose the access level, and approve:\n\n  ${url}\n`);
      log(`Callback: ${callback.redirectUri}`);
      if (openBrowser) execFile("xdg-open", [url], () => {});
      redirect = await waitForRedirect(callback, { timeoutMs, log });
    } else {
      const minted =
        approval === "mint-pairing-code"
          ? await mintPairingCode({ t3Bin, baseDir: t3BaseDir, label: `${clientName} approval` })
          : { code: await readLineFromStdin() };
      if (!minted.code) throw new Error("No pairing code was provided on stdin.");
      try {
        redirect = await approveWithPairingCode(issuer, params, { code: minted.code, access });
      } finally {
        // T3's CLI listing can still show an approval code after the server
        // spent it; revoke ours so no usable code outlives this run.
        if (minted.id) await revokePairingCode({ t3Bin, baseDir: t3BaseDir, id: minted.id });
      }
    }

    const code = parseRedirect(redirect, { redirectUri: callback.redirectUri, state, issuer });
    const token = await exchangeCode(metadata, {
      code,
      redirectUri: callback.redirectUri,
      clientId: client.client_id,
      verifier: pkce.verifier,
      resource,
    });
    const issuedAt = new Date();
    const claims = sessionClaims(token.access_token);
    return {
      token: token.access_token,
      metadata: {
        clientName,
        issuer,
        resource,
        scope: token.scope,
        access: access ?? (token.scope?.includes("orchestration:operate") ? "operate (ceiling chosen on approval page)" : "read-only"),
        approval,
        sessionId: claims?.sid,
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + token.expires_in * 1000).toISOString(),
      },
    };
  } finally {
    await callback.close();
  }
}

export function saveCredential(paths, { token, metadata }) {
  const previous = readJsonFile(paths.credentialFile);
  writePrivateFile(paths.t3AuthorizationFile, `Bearer ${token}`);
  writeJsonFile(paths.credentialFile, metadata);
  return previous;
}

export function loadAuthorizationHeader(paths) {
  if (!fs.existsSync(paths.t3AuthorizationFile)) {
    throw new Error(`No T3 credential at ${paths.t3AuthorizationFile}. Run: t3mcp auth`);
  }
  const value = readPrivateFile(paths.t3AuthorizationFile).trim();
  if (!value.startsWith("Bearer ")) {
    throw new Error(`${paths.t3AuthorizationFile} must hold a full "Bearer <token>" header value.`);
  }
  return value;
}

/** Initializes an MCP session with the credential and lists the native tool catalog. */
export async function verifyCredential({ mcpUrl, authorization }) {
  const client = new McpHttpClient({ url: mcpUrl, headers: { authorization } });
  try {
    const init = await client.initialize();
    const tools = await client.listTools();
    return {
      protocolVersion: init.protocolVersion,
      serverInfo: init.serverInfo,
      sessionIssued: client.sessionId !== undefined,
      tools,
    };
  } finally {
    await client.close();
  }
}

export function daysUntil(isoDate, now = new Date()) {
  return (new Date(isoDate).getTime() - now.getTime()) / 86_400_000;
}
