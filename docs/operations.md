# Operations

## Daily state

```bash
t3mcp status          # credential expiry and acceptance, service, /healthz, /readyz
t3mcp service logs    # last 200 tunnel-client journal lines
```

The tunnel-client admin UI is at <http://127.0.0.1:8786/ui>. Its log export is
redacted, but still review it before sharing.

## Renew the T3 credential (every 30 days)

T3 issues MCP client credentials for 30 days without a refresh token. Renewal is
therefore a new approval:

```bash
t3mcp auth --revoke-previous
```

This approves a new credential, verifies it, replaces the secret file, revokes the
previous T3 session (or prints how to do so without `--revoke-previous`), and
restarts `t3mcp-tunnel.service`, because tunnel-client reads `file:` values at startup.
The ChatGPT plugin needs no change.

`t3mcp-expiry-check.timer` runs daily. Within 7 days of expiry it writes a warning
to the journal (`journalctl --user -u t3mcp-expiry-check`) and sends a desktop
notification when one is available. Renewal is deliberately not automated: each
renewal re-confirms the owner's approval and access ceiling.

## Change the access level

Run `t3mcp auth --revoke-previous` and choose the new level on T3's approval page,
or pass `--approval pairing-code --access <level>`. Levels, from least to most:
`read-only`, `approval-required`, `auto-accept-edits`, `auto`, `full-access`.
Threads launched through the plugin cannot run with broader modes than this
ceiling. The plugin can send to or interrupt only threads within it.

## Revoke access immediately

Any of these cuts the Dot off:

- T3 Code → Settings → Connections → revoke **T3 Code (ChatGPT tunnel)**, or
  `t3 auth session revoke <sessionId>` (`sessionId` is in `~/.config/t3mcp/credential.json`).
- `t3mcp service stop` stops the tunnel. `t3mcp service uninstall` also removes the units.
- In ChatGPT, uninstall or delete the **T3 Code** plugin.
- In Platform, revoke the runtime API key or delete the tunnel.

## Rotate the OpenAI runtime key

Create a new runtime key in Platform, then:

```bash
t3mcp configure --runtime-key-stdin    # restarts the service
```

Revoke the old key in Platform afterwards.

## Upgrade tunnel-client

```bash
t3mcp install-tunnel-client vX.Y.Z
t3mcp service restart
t3mcp check --via-dev-proxy && t3mcp status
```

Earlier versions remain under `~/.local/share/t3mcp/tunnel-client/` for rollback:
point `~/.local/share/t3mcp/bin/tunnel-client` back at one and restart. A single
instance runs per tunnel ID; do not start a second `tunnel-client run` for the same
tunnel while the service is active.

## T3 upgrades

After a T3 Code update, run `t3mcp check` and `t3mcp status`. The tool catalog is
whatever T3 serves; ChatGPT picks up catalog changes when you refresh the plugin's
tools in its settings page. If T3 changes its OAuth flow, `t3mcp auth` reports the
failing step.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `t3mcp status` says the credential is not accepted | It expired or was revoked: run `t3mcp auth`. |
| Service active but `/readyz` not 200 | `t3mcp service logs`. Wrong tunnel ID or runtime key, missing Tunnels **Use**, or T3 not listening (`systemctl --user status t3code`). |
| Tunnel missing from ChatGPT's picker | Tunnel not scoped to that ChatGPT workspace, you lack Tunnels **Read** + **Use**, the service is not ready, or the tunnel was created moments ago. |
| ChatGPT reports the connector unreachable | The service is stopped or this machine is offline or asleep. Nothing is queued; retry when it is back. |
| Tool call returns `502 Bad Gateway` | tunnel-client is running but T3 is not answering on `127.0.0.1:3773`. |
| `thread_credential_required` | The tool acts as a calling T3 thread (`delegate_task`, `create_threads`, `request_secret`, preview/device tools). Launch a thread to do that work instead. |
| `runtime_mode_escalation_denied` or a send/interrupt refused | The target thread runs above the credential's ceiling. |
| `Pass modelSelection: the project has no default model` | Give `modelSelection` from `orchestrator_capabilities`. |
| A launch timed out or errored mid-flight | Do not relaunch. Search by its unique title or message (`t3_thread_search`, `t3_thread_list`). `t3mcp reconcile` does this for ledger entries. |
| `t3_thread_wait` returns `timedOut: true` | The run continues. Wait again or read later; keep waits to a few minutes. |

### ChatGPT tries to start OAuth

T3 publishes OAuth protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`,
and tunnel-client relays discovery. The plugin should be created with **No
authentication**. tunnel-client's injected header already authenticates every
forwarded request, including the startup probe, so `initialize` succeeds without a
challenge. If ChatGPT still insists on OAuth, its sign-in cannot complete: T3 only
accepts loopback redirect URIs and ChatGPT's callback is HTTPS. The fix then needs
a small local front proxy that hides the metadata, which is outside V1. Record what
ChatGPT showed in [validation.md](validation.md) first.

## Uninstall

```bash
t3mcp service uninstall
t3 auth session revoke "$(jq -r .sessionId ~/.config/t3mcp/credential.json)"
rm -rf ~/.config/t3mcp ~/.local/share/t3mcp ~/.local/state/t3mcp
```

Then remove the plugin in ChatGPT and the tunnel and runtime key in Platform.
