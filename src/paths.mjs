import os from "node:os";
import path from "node:path";

/**
 * Where T3mcp keeps its runtime state. Nothing here lives in the repository:
 * configuration and secrets go under the XDG config directory, downloaded
 * binaries under the XDG data directory.
 */
export function resolvePaths(env = process.env) {
  const home = env.HOME || os.homedir();
  const configHome = env.XDG_CONFIG_HOME || path.join(home, ".config");
  const dataHome = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  const stateHome = env.XDG_STATE_HOME || path.join(home, ".local", "state");
  const configDir = env.T3MCP_CONFIG_DIR || path.join(configHome, "t3mcp");
  const dataDir = env.T3MCP_DATA_DIR || path.join(dataHome, "t3mcp");
  const secretsDir = path.join(configDir, "secrets");
  return {
    configDir,
    secretsDir,
    settingsFile: path.join(configDir, "settings.json"),
    credentialFile: path.join(configDir, "credential.json"),
    tunnelProfileFile: path.join(configDir, "tunnel-client.yaml"),
    // Full `Bearer <token>` header value, read by tunnel-client via `file:`.
    t3AuthorizationFile: path.join(secretsDir, "t3-mcp-authorization"),
    // OpenAI tunnel runtime API key, read by tunnel-client via `file:`.
    runtimeKeyFile: path.join(secretsDir, "openai-tunnel-runtime-key"),
    dataDir,
    // Launch ledger for validation runs; outside the repository.
    launchLedgerFile: path.join(env.T3MCP_STATE_DIR || path.join(stateHome, "t3mcp"), "launches.jsonl"),
    tunnelClientBin: env.T3MCP_TUNNEL_CLIENT || path.join(dataDir, "bin", "tunnel-client"),
    systemdUserDir: path.join(configHome, "systemd", "user"),
  };
}

export const DEFAULT_T3_URL = "http://127.0.0.1:3773";
export const DEFAULT_HEALTH_ADDR = "127.0.0.1:8786";
export const SERVICE_NAME = "t3mcp-tunnel.service";
export const EXPIRY_SERVICE_NAME = "t3mcp-expiry-check.service";
export const EXPIRY_TIMER_NAME = "t3mcp-expiry-check.timer";
