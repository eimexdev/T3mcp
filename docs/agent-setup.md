# Agent setup guide

Instructions for a coding agent (Codex, Claude Code, or similar) asked to set up
T3mcp for a user. A typical request is *"Help me set up https://github.com/eimexdev/T3mcp
in my ChatGPT."* The user's instructions take precedence over this guide.

Goal: ChatGPT, including the user's Dots, can use the native T3 Code tools on this
machine through a personal **T3 Code** plugin.

You run everything on the machine where T3 Code runs. The user does the four UI
steps marked **User** below; ask for each one when you reach it and continue as soon
as they report back. Explain briefly why each one is theirs (see the README's
"Why some steps are manual").

## Rules

- Never print, echo, or paste secret values: the T3 bearer, the OpenAI runtime
  key, or pairing codes. Check them only with silent tests or `t3mcp status` / `t3mcp check`.
- Never reuse a T3 provider-session token. T3 passes one to agents it launches,
  and it may appear in process arguments. This setup needs its own credential from `t3mcp auth`.
- Secrets live only in `~/.config/t3mcp/secrets/` (mode 600). Never commit them,
  and never put them in the repo, chat, or logs.
- `t3_thread_launch` has no retry key. If you test a launch and the result is
  unclear, find the thread before trying again.

## 0. Check the machine

```bash
git clone https://github.com/eimexdev/T3mcp.git ~/T3mcp   # or reuse an existing checkout
cd ~/T3mcp && alias t3mcp="$PWD/bin/t3mcp.mjs"
node --version                          # 22 or newer
systemctl --user --version >/dev/null && loginctl show-user "$USER" -p Linger
curl -fsS http://127.0.0.1:3773/.well-known/oauth-protected-resource/mcp   # T3 Code is running
```

If T3 listens elsewhere, pass `--t3-url` to `auth` and `configure`. If lingering is
off, tell the user to run `sudo loginctl enable-linger $USER`; otherwise the tunnel
stops at logout. This is Linux and systemd only. On macOS, stop and say so.

## 1. Install tunnel-client

```bash
t3mcp install-tunnel-client
```

## 2. T3 credential: ask the user for the access level

Ask once, with this explanation: *the level caps what ChatGPT can do on this machine.
`full-access` lets launched agents edit and run commands without approval prompts.
With `approval-required`, launched threads wait for approval in T3's UI, which a Dot
cannot give.* Then:

```bash
t3mcp auth --approval mint-pairing-code --access <level>   # local owner approval via the t3 CLI
# or, if the user prefers to approve in the browser:
t3mcp auth            # prints a T3 URL; the user approves and picks the level there
t3mcp check --via-dev-proxy
```

`check --via-dev-proxy` must report the tool count and a successful
`t3_project_list` call.

## 3. User: create the tunnel

Ask the user to create a tunnel at <https://platform.openai.com/settings/organization/tunnels>
and paste its ID (`tunnel_` + 32 hex characters; not a secret). It must be in the
same organization as the runtime key, scoped to their ChatGPT account. You cannot
create it: the tunnel API requires an admin key, and the OpenAI Developers
connector has no tunnel tools.

## 4. Runtime API key

- **Codex with the OpenAI Developers plugin:** use its `openai-platform-api-key` flow
  to create a new key named "T3mcp tunnel runtime" (default org and project unless
  the user says otherwise). Run the helper's `decrypt` with
  `--workspace ~/.config/t3mcp/secrets --target ~/.config/t3mcp/secrets/runtime.env --env-name CONTROL_PLANE_API_KEY`.
- **Otherwise:** have the user create a normal (non-admin) key at
  <https://platform.openai.com/settings/organization/api-keys> and run the hidden
  prompt themselves: `t3mcp configure --tunnel-id <id> --runtime-key-stdin`.

## 5. Configure and start

```bash
t3mcp configure --tunnel-id <id> --runtime-key-env-file ~/.config/t3mcp/secrets/runtime.env
rm ~/.config/t3mcp/secrets/runtime.env
t3mcp service install
t3mcp status        # require: service active, /readyz 200, credential accepted
```

## 6. User: add the custom MCP server in ChatGPT

Ask the user, in ChatGPT on the web: **Plugins → + → Add custom MCP server**,
Name `T3 Code`, Connection **Tunnel** (their tunnel), Authentication **No
authentication** → confirm → **Create as a plugin** → **Install**.

To confirm from here, run
`journalctl --user -u t3mcp-tunnel.service --since -10min | grep "dispatcher forwarded"`.
New lines mean ChatGPT reached T3. If the user reports an OAuth prompt instead,
see `docs/operations.md`.

## 7. Permission (optional)

ChatGPT asks before most T3 Code actions by default. If the user wants unattended
Dot use, set the plugin-specific permission to **Allow all actions**: with Codex's
Plugin Management, call `update_app_permissions` with `app_id: "T3 Code"` and
`full_access`, then confirm with `get_app_permissions`. Do not change the global
default. Without that tool, the user sets it on the plugin page under **Permission**.

## 8. Skill and icon (optional; user uploads)

1. **User:** on the T3 Code plugin page, **⋯ → Download plugin ZIP**, and give you the
   file (an attachment or a path). It looks empty in file browsers; its files are hidden.
2. Build the new version:
   ```bash
   scripts/build-plugin.mjs --base <downloaded.zip>
   ```
   Check the output: the same `name`, an unchanged `.app.json`, `skills/t3-code/SKILL.md`,
   `assets/logo.png`, and no `mcp.json`.
3. Give the user `dist/t3-code-plugin-<version>.zip`: the local path, or a
   download link if they are on another machine and approve hosting it. It
   contains no secrets.
4. **User:** **⋯ → Upload new version**, then check that the app still shows
   **Connected** and the permission is unchanged.

Plugin Creator's `update_plugin` cannot do this: plugins created with **Add custom
MCP server** are not listed as editable. Do not add an `mcp.json`; ChatGPT would
mark the plugin Desktop only.

## 9. User: enable for the Dot and test

Ask the user to enable T3 Code for their Dot and send it
*"Use T3 Code to list my T3 projects."* Watch the journal while they do. For a fuller
test, have the Dot launch a `scratch: true` thread with an explicit `modelSelection`,
wait, read, send a follow-up, and interrupt. Report results with thread and run IDs.

## Finish

Tell the user what is running (`t3mcp-tunnel.service`, the daily expiry check), when
the T3 credential expires (`t3mcp status`), and how to renew
(`t3mcp auth --revoke-previous`) or revoke access (T3 → Settings → Connections,
or `t3mcp service stop`).
