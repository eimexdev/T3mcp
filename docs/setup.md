# Setup

This guide connects a ChatGPT Dot to the T3 Code server on this machine. Steps 1–3
and 5 run in a terminal on the machine. Steps 4 and 6 need the account owner in the
OpenAI Platform and ChatGPT web UIs.

Throughout, `t3mcp` means `bin/t3mcp.mjs` in this repository:

```bash
cd /path/to/T3mcp
alias t3mcp="$PWD/bin/t3mcp.mjs"
```

## Prerequisites

- Linux with systemd user services. Enable lingering (`loginctl show-user $USER -p Linger`)
  so the tunnel keeps running after logout: `sudo loginctl enable-linger $USER`.
- Node.js 22 or newer, `curl`, `unzip`, `sha256sum`. If `gh` is installed and
  authenticated, it is also used to verify release provenance.
- T3 Code running locally. The default origin is `http://127.0.0.1:3773`; pass
  `--t3-url` if yours differs.
- An OpenAI Platform organization with Secure MCP Tunnels, where you hold Tunnels
  **Read** + **Use** (plus **Manage** to create the tunnel yourself).
- A ChatGPT account or workspace that allows custom MCP plugins. Workspace
  restrictions, including Lockdown, apply.

## 1. Install tunnel-client

```bash
t3mcp install-tunnel-client            # latest release, or: t3mcp install-tunnel-client v0.0.16
```

This downloads the official `openai/tunnel-client` release for this platform. It
checks the archive against `SHA256SUMS.txt`, verifies the signed release provenance
with `gh attestation verify` when `gh` is available, and installs it to
`~/.local/share/t3mcp/tunnel-client/<version>/`. `~/.local/share/t3mcp/bin/tunnel-client`
points at the installed version. On macOS, use `brew install openai/tools/tunnel-client` instead.

## 2. Obtain the dedicated T3 MCP credential

```bash
t3mcp auth
```

The helper reads T3's OAuth metadata and registers a client named **T3 Code
(ChatGPT tunnel)** with a loopback callback on a random port. It then prints T3's
approval URL. Open it in a browser signed in to T3 Code as the owner, choose the
**access level** for ChatGPT, and approve. The browser returns to the callback, and
the helper exchanges the code (PKCE S256), verifies the token against `/mcp`, and
saves `Bearer <token>` to `~/.config/t3mcp/secrets/t3-mcp-authorization` with mode 600.

- **Browser on another machine** (for example, T3 reached through T3 Connect): run
  `t3mcp auth --t3-url https://<your T3 address>`. When approval finishes, the
  browser cannot load the loopback page. Copy that page's full address into the
  terminal prompt instead.
- **Terminal-only approval:** `t3 auth pairing create` issues a one-time code. Run
  `t3mcp auth --approval pairing-code --access <level>` and paste the code on stdin.
  `--approval mint-pairing-code --access <level>` mints a 2-minute code with the
  local `t3` CLI, uses it once, and revokes it. Use this only when you are the owner
  at this machine's terminal; it approves without the browser page.

Choosing the access level: the credential is the plugin's permission ceiling.

| Access | What the plugin can do |
| --- | --- |
| `read-only` | Read projects, threads, and results; no launches or sends. |
| `approval-required` | Launch and send; launched threads ask for approval of tool actions **in T3's UI**. A Dot cannot answer permission prompts. |
| `auto-accept-edits` / `auto` | Launched threads may edit, or edit and act, without prompts per that runtime mode. |
| `full-access` | Required to send to or interrupt existing full-access threads. |

Anyone who can use the plugin and the tunnel can act on this machine up to this
ceiling. Keep the plugin personal, not shared with a workspace, and keep tunnel
**Use** permission limited to you. Choose the lowest level that covers the
work you want Dots to do. To change it later, run `t3mcp auth` again; see
[operations](operations.md#change-the-access-level).

Check it:

```bash
t3mcp check                  # direct to native T3
t3mcp check --via-dev-proxy  # through the stock tunnel-client, locally
```

The second check runs `tunnel-client dev proxy` with the same profile shape as
production and sends requests without an Authorization header. Success shows that
tunnel-client injects the credential and forwards to native T3.

## 3. Optional: lifecycle self-test

```bash
t3mcp validate-lifecycle --via-dev-proxy --model-json '{"instanceId":"claudeAgent","model":"claude-haiku-4-5"}'
```

This launches a harmless thread in T3's Scratch workspace and waits for it, then
reads the result, sends a follow-up, and interrupts a deliberately long turn. Pick
any provider instance and model from `orchestrator_capabilities`. Thread and run IDs
are printed and appended to `~/.local/state/t3mcp/launches.jsonl`. With a `read-only`
credential this test is refused, which is correct.

## 4. Create the tunnel and runtime key (OpenAI Platform)

1. **Tunnel (Platform UI only).** Open **Tunnels** at <https://platform.openai.com/settings/organization/tunnels>
   and create a tunnel, for example *T3 Code (main machine)*, in the same organization
   as the runtime key. Scope it to the ChatGPT account or workspace you will use, or it
   will not appear in ChatGPT's tunnel picker. Copy its ID (`tunnel_` + 32 hex
   characters); it is not secret. The tunnel API needs an admin key, and neither
   regular API keys nor the OpenAI Developers connector can create tunnels.
2. **Runtime API key.** Either create one at <https://platform.openai.com/settings/organization/api-keys>
   (you need Tunnels **Read** + **Use**; not an admin key), or let Codex create it with the
   OpenAI Developers plugin's encrypted flow. Have Codex write it to
   `~/.config/t3mcp/secrets/runtime.env` as `CONTROL_PLANE_API_KEY=…` (mode 600) and
   pass `--runtime-key-env-file` below.

## 5. Configure and start the tunnel service

```bash
t3mcp configure --tunnel-id tunnel_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx --runtime-key-stdin
#   paste the runtime key at the hidden prompt, or instead:
#   --runtime-key-env-file ~/.config/t3mcp/secrets/runtime.env
t3mcp doctor
t3mcp service install
t3mcp status
```

`configure` writes the key to `~/.config/t3mcp/secrets/openai-tunnel-runtime-key` (600)
and generates `~/.config/t3mcp/tunnel-client.yaml`. The profile points the `main`
channel at `http://127.0.0.1:3773/mcp`. It adds `Authorization: file:…/t3-mcp-authorization`
to MCP requests and to discovery/probe requests. `doctor` probes without that header,
so its `HTTP 401 from …/mcp` line is expected.

`service install` writes and starts:

- `t3mcp-tunnel.service`: runs `tunnel-client run --profile-file ~/.config/t3mcp/tunnel-client.yaml`
  with `Restart=always`, ordered after `t3code.service`. Logs go to the user journal.
- `t3mcp-expiry-check.timer`: runs daily and logs, and sends a desktop notification
  when fewer than 7 days remain on the T3 credential.

Proceed when `t3mcp status` shows `service: active` and `/readyz 200`. The
health/admin UI is at <http://127.0.0.1:8786/ui> (loopback only).

## 6. Create the ChatGPT plugin and enable it for the Dot

The plugin has two parts:

- **The connection:** a custom MCP app using **Connection: Tunnel**. An uploaded plugin
  archive cannot declare this. Portable `mcp.json` only takes a URL, and ChatGPT marks
  imported plugins that declare MCP servers in `mcp.json` as **Desktop only**, which a
  Dot could not use. So the connection is created once in the UI.
- **The guidance:** `plugin/t3-code` in this repository contains the **T3 Code** skill
  (explicit IDs, safe launches, bounded waits, retry-safe sends), the icon,
  and listing metadata. `scripts/build-plugin.mjs` packages it into `dist/`.

Steps, while the service is running:

1. In ChatGPT on the web, open **Plugins**, select **+**, then **Add custom MCP server**.
   Set **Name** to `T3 Code`, **Connection** to **Tunnel** (select the tunnel from step 4),
   and **Authentication** to **No authentication**. Confirm the risk warning and
   select **Create as a plugin**. T3 still advertises OAuth metadata; if ChatGPT tries to
   start an OAuth sign-in anyway, stop and see
   [troubleshooting](operations.md#chatgpt-tries-to-start-oauth).
2. Add the guidance to that plugin. Either:
   - have Codex (Plugin Creator) overlay the archive from `scripts/build-plugin.mjs`
     onto the new plugin with `update_plugin` and a new version. This keeps one plugin, or
   - run `scripts/build-plugin.mjs --app-id <the custom MCP app's ID>` and upload the
     archive with **Upload plugin archive**. The archive references the tunnel app
     through `.app.json` instead of declaring an MCP server.
3. **Install** the plugin and make sure it is enabled for the account the Dot uses.

## 7. Verify from the Dot

Do these in order and keep the IDs the Dot reports.

1. Read-only call. Ask the Dot:
   > Use @T3 Code to call `t3_project_list` and tell me the project names and IDs.

   Check the local side: `t3mcp service logs` shows the forwarded `tools/call`.
2. Harmless launch in a disposable workspace:
   > Use @T3 Code. Call `orchestrator_capabilities`, then `t3_thread_launch` with
   > `scratch: true`, title "Dot tunnel test", modelSelection
   > `{"instanceId":"claudeAgent","model":"claude-haiku-4-5"}`, and message
   > "Reply with exactly: DOT-TUNNEL-OK. Do not use tools." Report the threadId and runId.
   > Then call `t3_thread_wait` with that threadId and runId and timeoutMs 60000, then
   > `t3_thread_read` and quote the assistant reply.

   If the launch call errors or times out, do not let the Dot launch again until it
   has searched for the title with `t3_thread_list`/`t3_thread_search`.
3. Follow-up:
   > Use @T3 Code `t3_thread_send` on that threadId with mode "queue", clientRequestId
   > "dot-followup-1", and message "Reply with exactly: DOT-FOLLOWUP-OK." Wait for the
   > returned runId with timeoutMs 60000 and read the reply.
4. Interruption:
   > Use @T3 Code `t3_thread_send` on that threadId with mode "queue", clientRequestId
   > "dot-long-1", and message "Write the numbers 1 to 3000 in words, one per line."
   > Then immediately call `t3_thread_interrupt` with that runId and clientRequestId
   > "dot-interrupt-1", then `t3_thread_wait` on the run, and report its final status.
5. Check that the thread is visible in T3 Code's UI under the Scratch project.
6. Unavailable machine: run `t3mcp service stop`, ask the Dot to repeat step 1 and
   note the error ChatGPT shows, then run `t3mcp service start`.

ChatGPT confirms write actions by default. Tools without `readOnlyHint: true`
(including `t3_thread_read`, which T3 marks as not read-only because reads can
acknowledge delegated results) ask for confirmation unless you choose to remember
the approval for the conversation.
