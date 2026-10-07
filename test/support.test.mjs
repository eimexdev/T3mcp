import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseRpcBody } from "../src/mcp.mjs";
import { assertTunnelId, renderExpiryCheck, renderTunnelProfile, renderTunnelService } from "../src/render.mjs";
import { readPrivateFile, writePrivateFile } from "../src/fsutil.mjs";
import { LaunchLedger } from "../src/lifecycle.mjs";
import { resolvePaths } from "../src/paths.mjs";

const TUNNEL_ID = "tunnel_0123456789abcdef0123456789abcdef";

test("parseRpcBody handles JSON, batches, and SSE", () => {
  assert.deepEqual(parseRpcBody("application/json", '{"jsonrpc":"2.0","id":1,"result":{}}', 1).result, {});
  assert.equal(parseRpcBody("application/json", '[{"id":2},{"id":3,"result":7}]', 3).result, 7);
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n' +
    'event: message\ndata: {"jsonrpc":"2.0","id":4,"result":{"ok":true}}\n\n';
  assert.equal(parseRpcBody("text/event-stream", sse, 4).result.ok, true);
  assert.equal(parseRpcBody("text/event-stream", sse, 5), undefined);
});

test("tunnel profile references secrets by file and holds none", () => {
  const yaml = renderTunnelProfile({
    tunnelId: TUNNEL_ID,
    runtimeKeyFile: "/home/u/.config/t3mcp/secrets/openai-tunnel-runtime-key",
    t3McpUrl: "http://127.0.0.1:3773/mcp",
    t3AuthorizationFile: "/home/u/.config/t3mcp/secrets/t3-mcp-authorization",
    healthAddr: "127.0.0.1:8786",
  });
  assert.match(yaml, /api_key: "file:\/home\/u\/.config\/t3mcp\/secrets\/openai-tunnel-runtime-key"/);
  assert.match(yaml, /extra_headers:\n    Authorization: "file:/);
  assert.match(yaml, /discovery_extra_headers:\n    Authorization: "file:/);
  assert.match(yaml, /url: "http:\/\/127.0.0.1:3773\/mcp"/);
  assert.doesNotMatch(yaml, /sk-|Bearer /);
});

test("tunnel IDs are validated", () => {
  assert.doesNotThrow(() => assertTunnelId(TUNNEL_ID));
  assert.throws(() => assertTunnelId("tunnel_XYZ"));
  assert.throws(() => assertTunnelId(undefined));
});

test("systemd units run the stock client and the expiry check", () => {
  const unit = renderTunnelService({ tunnelClientBin: "/opt/tc/tunnel-client", profileFile: "/cfg/tunnel-client.yaml" });
  assert.match(unit, /ExecStart=\/opt\/tc\/tunnel-client run --profile-file \/cfg\/tunnel-client.yaml/);
  assert.match(unit, /Restart=always/);
  const { service, timer } = renderExpiryCheck({ nodeBin: "/usr/bin/node", cliPath: "/repo/bin/t3mcp.mjs", warnDays: 7 });
  assert.match(service, /expiry-check --warn-days 7/);
  assert.match(timer, /OnCalendar=daily/);
});

test("private files are written 0600 and group-readable ones are refused", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3mcp-test-"));
  try {
    const file = path.join(dir, "secrets", "value");
    writePrivateFile(file, "secret");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
    assert.equal(readPrivateFile(file), "secret");
    fs.chmodSync(file, 0o640);
    assert.throws(() => readPrivateFile(file), /readable by other users/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("launch ledger reports launches without a recorded outcome", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3mcp-ledger-"));
  try {
    const ledger = new LaunchLedger(path.join(dir, "launches.jsonl"));
    ledger.append({ ref: "a", marker: "A", stage: "intent" });
    ledger.append({ ref: "a", marker: "A", stage: "accepted", threadId: "t1" });
    ledger.append({ ref: "b", marker: "B", stage: "intent" });
    ledger.append({ ref: "c", marker: "C", stage: "intent" });
    ledger.append({ ref: "c", marker: "C", stage: "uncertain" });
    ledger.append({ ref: "d", marker: "D", stage: "intent" });
    ledger.append({ ref: "d", marker: "D", stage: "rejected" });
    assert.deepEqual(ledger.unresolved().map((entry) => entry.marker), ["B", "C"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime paths stay outside the repository", () => {
  const paths = resolvePaths({ HOME: "/home/u" });
  assert.equal(paths.t3AuthorizationFile, "/home/u/.config/t3mcp/secrets/t3-mcp-authorization");
  assert.equal(paths.tunnelClientBin, "/home/u/.local/share/t3mcp/bin/tunnel-client");
  assert.equal(paths.launchLedgerFile, "/home/u/.local/state/t3mcp/launches.jsonl");
});
