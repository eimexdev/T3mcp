# T3mcp

Drive [T3 Code](https://github.com/pingdotgg/t3code) on your own machine from
ChatGPT, including Dots. You can list projects, launch coding threads, wait for and
read their results, send follow-ups, and interrupt runs. The work runs and stays in
T3 Code on your machine.

```text
ChatGPT / Dot
  -> custom MCP plugin "T3 Code"  (Connection: Tunnel, No authentication)
  -> OpenAI Secure MCP Tunnel     (hosted by OpenAI; nothing inbound on your machine)
  -> tunnel-client                (official OpenAI daemon, systemd user service)
       adds Authorization: Bearer <dedicated T3 MCP credential>
  -> T3 Code's native /mcp        (127.0.0.1)
```

There is no custom server or proxy. ChatGPT sees T3's own MCP tool catalog, and
T3 enforces its own permissions. This repository contains a small setup CLI
(`t3mcp`), a systemd unit, an optional ChatGPT skill, and docs.

> Unofficial. Not affiliated with T3 Tools or OpenAI. Linux with systemd only for now.

## Set up with an agent

On the machine that runs T3 Code, ask your coding agent (Codex, Claude Code, or similar):

> Help me set up https://github.com/eimexdev/T3mcp in my ChatGPT.

It follows [docs/agent-setup.md](docs/agent-setup.md). It does the terminal work
and asks you for the few ChatGPT and OpenAI Platform clicks it cannot do. The rest
of this README is the same process by hand.

## What you are granting

Anyone who can use this ChatGPT plugin can act on your machine through T3, up to the
access level you approve. At `full-access`, that includes launching agents that edit
files and run commands. Keep the plugin **personal**, not shared to a workspace,
and limit Tunnels **Use** permission in your OpenAI organization to yourself. Revoke
access at any time from T3 → Settings → Connections, or stop the service.

## Requirements

- Linux with systemd user services and lingering enabled (`sudo loginctl enable-linger $USER`)
- Node.js 22 or newer, `curl`, `unzip`, `zip`; optionally the GitHub CLI (`gh`) to verify release provenance
- T3 Code running locally (default `http://127.0.0.1:3773`)
- An OpenAI Platform organization with Secure MCP Tunnels, where you have Tunnels
  **Read + Use** (plus **Manage** to create the tunnel)
- A ChatGPT account that can add custom MCP plugins

API credits are not needed: in testing, ChatGPT's calls through the tunnel worked for an organization with no API credit balance.

## Setup at a glance

| # | Step | Who can do it |
| --- | --- | --- |
| 1 | Clone this repo and install tunnel-client | Codex or any terminal agent |
| 2 | Approve a dedicated T3 MCP credential | Codex (pairing code), or you in the browser |
| 3 | Create the tunnel in OpenAI Platform | **You** |
| 4 | Create the tunnel runtime API key | Codex with the OpenAI Developers plugin, or you |
| 5 | Configure and start the tunnel service | Codex or any terminal agent |
| 6 | Add the custom MCP server in ChatGPT | **You** |
| 7 | Set ChatGPT's permission for the plugin (optional) | Codex with Plugin Management, or you |
| 8 | Add the T3 Code skill and icon (optional) | Codex builds it; **you** download and upload in ChatGPT |
| 9 | Enable the plugin for your Dot and try it | **You** |

### Why some steps are manual

- **Tunnel creation.** The tunnel API requires an OpenAI *admin* key. Regular API
  keys get `403 Please use an admin API key`, and the OpenAI Developers connector
  has no tunnel tools. Creating the tunnel in the Platform UI takes about a minute,
  and it is safer than handing an agent an admin key.
- **The ChatGPT connection.** A plugin archive cannot declare a tunnel connection:
  portable `mcp.json` only takes a URL. ChatGPT also marks imported plugins that
  declare MCP servers as **Desktop only**, which a Dot cannot use. Use
  **Add custom MCP server** in ChatGPT.
- **Enabling for a Dot and uploading plugin versions** are ChatGPT UI actions that no
  available tool performs. Plugin Creator's tools do not list plugins created with
  **Add custom MCP server**.

## Install

### 1. Clone and install tunnel-client

```bash
git clone https://github.com/eimexdev/T3mcp.git && cd T3mcp
alias t3mcp="$PWD/bin/t3mcp.mjs"
t3mcp install-tunnel-client     # official release, checksum and provenance verified
```

### 2. Get a dedicated T3 MCP credential

T3 issues MCP credentials through its own OAuth approval. Pick one method:

```bash
t3mcp auth                                                    # prints a T3 approval URL; choose the access level there
t3mcp auth --approval mint-pairing-code --access full-access  # terminal-only: the local t3 CLI mints a one-time code
```

The credential appears in T3 → Settings → Connections as **T3 Code (ChatGPT tunnel)**.
It is stored at `~/.config/t3mcp/secrets/t3-mcp-authorization` (mode 600) and
lasts **30 days**; T3 issues no refresh token. Access levels, from least to most:
`read-only`, `approval-required`, `auto-accept-edits`, `auto`, `full-access`.
With `approval-required`, launched threads wait for approval in T3's UI, which a Dot
cannot give.

Check it: `t3mcp check` (direct) and `t3mcp check --via-dev-proxy` (through tunnel-client, locally).

### 3. Create the tunnel (you)

Platform → [Tunnels](https://platform.openai.com/settings/organization/tunnels) → **Create tunnel**.
Use the same organization as the runtime key, and scope it to the ChatGPT account
you will use. Copy the ID (`tunnel_…`); it is not a secret.

### 4. Create the runtime API key

Either create a normal (non-admin) key at
[API keys](https://platform.openai.com/settings/organization/api-keys), or ask Codex
(see below) to create one with the OpenAI Developers plugin and write it to
`~/.config/t3mcp/secrets/runtime.env` as `CONTROL_PLANE_API_KEY=…`.

### 5. Configure and start

```bash
t3mcp configure --tunnel-id tunnel_xxxxxxxx --runtime-key-stdin          # paste the key (hidden)
#   or: --runtime-key-env-file ~/.config/t3mcp/secrets/runtime.env      (then delete that file)
t3mcp service install    # t3mcp-tunnel.service + daily credential expiry check
t3mcp status             # wait for: service active, /readyz 200
```

### 6. Connect ChatGPT (you)

ChatGPT → **Plugins** → **+** → **Add custom MCP server**: Name `T3 Code`,
Connection **Tunnel** (select your tunnel), Authentication **No authentication** →
accept the warning → **Create as a plugin** → **Install**. The service must be
running. ChatGPT sends no credential; tunnel-client adds T3's on your machine.

### 7–9. Permissions, skill, Dot

- **Permissions:** by default ChatGPT asks before most write actions. For unattended
  Dot use, set T3 Code's app-specific permission to **Allow all actions** in the
  plugin's settings, or have Codex do it.
- **Skill and icon:** on the plugin's page in ChatGPT, open **⋯ → Download plugin ZIP**,
  then run `scripts/build-plugin.mjs --base <downloaded.zip>` and upload
  `dist/t3-code-plugin-<version>.zip` with **⋯ → Upload new version**. This adds the
  T3 Code skill (a short guide to launching safely and waiting with bounded calls as
  an outside client), the icon, and listing text. The plugin's name and tunnel-app
  binding are kept. The downloaded zip looks empty in most file browsers because its
  files (`.app.json`, `.codex-plugin/`) are hidden.
- **Dot:** enable T3 Code for your Dot, then try: *"Use T3 Code to list my T3 projects."*

More detail: [docs/setup.md](docs/setup.md).

## What an agent can and cannot do

An agent on this machine can do every terminal step. With Codex's **OpenAI
Developers** plugin it can also create the runtime API key, and with **Plugin
Management** it can set T3 Code's ChatGPT permission. These steps stay with you:
creating the tunnel, adding the custom MCP server, downloading the plugin ZIP and
uploading the new version, and enabling the plugin for your Dot. Details and
exact commands: [docs/agent-setup.md](docs/agent-setup.md).

## Day to day

| Task | Command |
| --- | --- |
| Health, expiry, and service status | `t3mcp status` |
| Renew the T3 credential (every 30 days; a daily timer warns 7 days ahead) | `t3mcp auth --revoke-previous` |
| Tunnel logs | `t3mcp service logs` |
| Stop or start the tunnel | `t3mcp service stop` / `t3mcp service start` |
| Upgrade tunnel-client | `t3mcp install-tunnel-client vX.Y.Z && t3mcp service restart` |
| Local end-to-end self-test (Scratch thread) | `t3mcp validate-lifecycle --via-dev-proxy --model-json '{"instanceId":"claudeAgent","model":"claude-haiku-4-5"}'` |

Revocation, key rotation, troubleshooting, and uninstalling: [docs/operations.md](docs/operations.md).

## Good to know

- **Full catalog, native rules.** ChatGPT sees all of T3's tools. Tools that act as a
  calling T3 thread (`delegate_task`, `create_threads`, `request_secret`, preview,
  device, and HTML tools) return `thread_credential_required` for an outside client;
  a launched thread can still use them.
- **Launches have no retry key.** If a launch times out, look for the thread
  (`t3_thread_list` / `t3_thread_search`) before launching again.
- **Bounded waits.** Keep `t3_thread_wait` to about 1–2 minutes and repeat. A wait
  timing out does not stop the run.
- **Machine must be on.** If the machine, T3, or the service is down, calls fail and
  nothing is queued.

## Files

Runtime state stays outside the repository:

| Path | Contents |
| --- | --- |
| `~/.config/t3mcp/secrets/` | T3 bearer and OpenAI runtime key (mode 600) |
| `~/.config/t3mcp/tunnel-client.yaml` | tunnel-client profile; references the secrets with `file:` |
| `~/.config/t3mcp/{credential,settings}.json` | Non-secret metadata (expiry, session ID, tunnel ID) |
| `~/.local/share/t3mcp/` | Verified tunnel-client releases |
| `~/.config/systemd/user/t3mcp-*` | Generated units; logs go to the user journal |

## Development

`npm test` runs the unit tests. [docs/validation.md](docs/validation.md) records what
has been verified against T3 and the live tunnel.

## License

MIT; see [LICENSE](LICENSE). The T3 Code icon in `plugin/t3-code/assets/` comes from
T3 Code (MIT, © T3 Tools Inc.); see [NOTICE](NOTICE).
