# T3mcp

Use the native T3 Code MCP tools from a ChatGPT Dot through a personal plugin
called **T3 Code**.

```text
ChatGPT Dot / conversation
  -> personal plugin "T3 Code" (Connection: Tunnel, No authentication)
  -> OpenAI Secure MCP Tunnel (hosted)
  -> stock tunnel-client on this machine (systemd user service, outbound HTTPS only)
       injects Authorization: Bearer <dedicated T3 MCP credential>
  -> native T3 Code /mcp on 127.0.0.1:3773
  -> T3 launches, runs, and persists threads on this machine
```

This is V1 from [.plans/v1-single-machine.md](.plans/v1-single-machine.md). It adds
no hosted adapter or proxy, and no Sites, completion events, UI, second machine, or
offline queue. The repository holds only the helper CLI, configuration templates,
supervision units, and documentation. Secrets and runtime configuration stay in
`~/.config/t3mcp`.

## What you get

- The complete native T3 catalog (80 tools on T3 `0.0.46-nightly.20261006.2752`).
  The ChatGPT plugin sees exactly what T3 serves: names, schemas, and annotations.
- T3's permission checks are unchanged. The plugin acts as an *external* MCP client
  with the access ceiling approved for its credential. Tools that act as a calling
  T3 thread (`delegate_task`, `task_status`, `create_threads`, `request_secret`,
  preview/device/HTML tools) are listed, but T3 refuses them with
  `thread_credential_required`. A thread the plugin launches can still use them
  inside its own run.
- A dedicated T3 credential, obtained through T3's own OAuth approval flow. It
  appears in T3's Connections list as **T3 Code (ChatGPT tunnel)** and can be
  revoked there. It lasts 30 days and T3 issues no refresh token, so renewal
  repeats the approval (`t3mcp auth`). A daily timer warns 7 days before expiry.

## Quick start

Requirements: Linux with systemd user services, Node.js 22 or newer, a running
T3 Code server, OpenAI Platform access to Secure MCP Tunnels (Tunnels **Read** + **Use**),
and permission to add a custom MCP plugin in ChatGPT.

```bash
git clone https://github.com/eimexdev/T3mcp.git && cd T3mcp
alias t3mcp="$PWD/bin/t3mcp.mjs"

t3mcp install-tunnel-client             # stock openai/tunnel-client, checksum + provenance verified
t3mcp auth                              # approve a dedicated T3 MCP credential in your browser
t3mcp check --via-dev-proxy             # native T3 through tunnel-client, locally
t3mcp configure --tunnel-id tunnel_... --runtime-key-stdin   # paste the runtime key (hidden)
t3mcp service install                   # systemd: tunnel + daily expiry check
t3mcp status
```

Then create the plugin in ChatGPT; see [docs/setup.md](docs/setup.md) for each
Platform and ChatGPT step and the prompts for the first Dot test.

## Commands

| Command | Purpose |
| --- | --- |
| `install-tunnel-client [vX.Y.Z]` | Download the official release, verify `SHA256SUMS.txt` and signed provenance, install under `~/.local/share/t3mcp`. |
| `auth` | Register a loopback OAuth client with T3, run PKCE approval, exchange the code, verify the token, and save it as `Bearer <token>` (mode 600). Restarts the tunnel service if it is running. |
| `configure` | Store the OpenAI tunnel runtime key (stdin, hidden) and write the tunnel-client profile. |
| `check [--via-dev-proxy]` | Initialize, list tools, and make one read-only call (`t3_project_list`) directly or through tunnel-client's local dev proxy. |
| `validate-lifecycle [--via-dev-proxy]` | Launch a harmless Scratch thread, wait, read, follow up, and interrupt; records IDs in a launch ledger. |
| `reconcile` | Resolve launches whose outcome was never recorded, by searching for their unique marker. |
| `doctor` | `tunnel-client doctor --explain` on the profile. |
| `service install\|uninstall\|start\|stop\|restart\|status\|logs` | Manage `t3mcp-tunnel.service` and `t3mcp-expiry-check.timer`. |
| `status [--json]` | Credential expiry and acceptance, tunnel service, `/healthz` and `/readyz`. |

## Files outside the repository

| Path | Contents |
| --- | --- |
| `~/.config/t3mcp/secrets/t3-mcp-authorization` | `Bearer <T3 MCP token>` (600) |
| `~/.config/t3mcp/secrets/openai-tunnel-runtime-key` | OpenAI tunnel runtime API key (600) |
| `~/.config/t3mcp/tunnel-client.yaml` | tunnel-client profile; references the two files above with `file:` |
| `~/.config/t3mcp/credential.json`, `settings.json` | Non-secret metadata: expiry, session ID, access, tunnel ID |
| `~/.local/share/t3mcp/` | Verified tunnel-client release |
| `~/.local/state/t3mcp/launches.jsonl` | Launch ledger from validation runs |
| `~/.config/systemd/user/t3mcp-*` | Generated units; logs go to the user journal |

## Documentation

- [docs/setup.md](docs/setup.md): installation, Platform tunnel, ChatGPT plugin, and Dot verification
- [docs/operations.md](docs/operations.md): renewal, revocation, access levels, upgrades, troubleshooting
- [docs/validation.md](docs/validation.md): what has been verified, with evidence, and what still needs the account owner
- [RESEARCH.md](RESEARCH.md) and [.plans/](.plans): the research and phase plans behind this design

## Using it from a Dot

- `t3_thread_launch` has **no idempotency key**. Keep the returned `threadId` and
  `runId`. If a launch response is lost, look for the thread (`t3_thread_search` or
  `t3_thread_list` with a unique title) before launching again.
- Use bounded waits, for example `t3_thread_wait` with `timeoutMs` of 30000-120000,
  then read with `t3_thread_read` (use `afterPosition` for increments). A wait timing
  out does not stop the run. tunnel-client caps one MCP request at 10 minutes.
- Use `clientRequestId` on `t3_thread_send` and `t3_thread_interrupt` so retries are safe.
- Outside a T3 thread, give explicit targets: `projectId` (from `t3_project_list`) or
  `scratch: true`, plus `modelSelection` when the project has no default model
  (`orchestrator_capabilities` lists providers and models).
- If this machine, T3, or the tunnel service is down, calls fail. tunnel-client
  answers `502 Bad Gateway` when T3 is unreachable. Nothing is queued for later.
