# Validation record

What has been verified, and how. Account-specific identifiers (organization,
project, tunnel, session, and thread IDs) are omitted.

## Versions tested (October 2026)

- T3 Code server `0.0.46-nightly.20261006.2752`. Source checked against upstream
  `pingdotgg/t3code` at `bfec2387b8102975c84690f99be0f5f834fd0cbe`: `apps/server/src/auth/McpOAuth.ts`,
  `auth/EnvironmentAuth.ts`, `mcp/McpHttpServer.ts`, `mcp/McpToolAccess.ts`, `cli/auth.ts`.
- tunnel-client `v0.0.16`, linux-amd64. The archive matched `SHA256SUMS.txt`, and
  `gh attestation verify` accepted the release's signed provenance.

## T3 behavior this project relies on

- **OAuth:** protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`;
  stateless dynamic registration that accepts **only** loopback redirects; PKCE S256;
  public clients; `authorization_code` only. Codes last 60 s and are single use. Client
  sessions last **30 days** with **no refresh token**.
- **Access ceilings:** `read-only`, `approval-required`, `auto-accept-edits`, `auto`,
  `full-access`. Approval comes from an owner browser session or a one-time pairing code.
- **Token scope:** external client tokens work only on `/mcp`, not on the HTTP API or
  WebSocket. The client has no calling thread.
- **Transport:** Streamable HTTP with `Mcp-Session-Id`. The server declares protocol
  `2025-06-18` and answers newer `initialize` versions with it. Requests sent without
  a prior `initialize` get HTTP 400.

## Local checks

| Check | Result |
| --- | --- |
| Dedicated credential via T3 OAuth (pairing-code approval), not derived from any provider-session token | Pass |
| Discovery: 80 tools (25 annotated read-only); read-only `t3_project_list` call | Pass |
| Stock tunnel-client (`dev proxy`, production profile shape) forwarding with **no** client-side Authorization header | Pass |
| Full catalog listed; `delegate_task` and `request_secret` refused with `thread_credential_required` | Pass |
| Scratch-workspace lifecycle through tunnel-client: launch, bounded wait, read, queued follow-up (`clientRequestId`), interrupt → `interrupted` | Pass |
| Launch ledger: a rejected launch was recorded and reconciled (no thread found) before relaunching | Pass |
| T3 killed behind tunnel-client: next call gets HTTP 502 within milliseconds, no hang | Pass |
| `tunnel-client doctor` on the generated profile | Pass (its own probe shows the expected 401) |
| Unit tests (`npm test`) | 12 pass |

## Live setup

| Step | Result |
| --- | --- |
| Runtime API key created by Codex through the OpenAI Developers plugin's encrypted flow and written to the secrets file without being displayed | Done |
| Tunnel created in the Platform UI. The tunnel API rejects regular keys: *Please use an admin API key* | Manual |
| `t3mcp-tunnel.service` against the hosted control plane: tunnel metadata fetched, `/readyz` 200 | Pass |
| ChatGPT custom MCP server with **Connection: Tunnel** + **No authentication**: connected without an OAuth prompt even though T3 advertises OAuth metadata; `initialize`, `notifications/initialized`, and the tool listing were forwarded, and T3 issued a session | Pass |
| ChatGPT app-specific permission set to "Allow all actions" by Codex (`plugin_management.update_app_permissions`) | Done |
| Owner's use from ChatGPT ("everything works fine") | Pass |
| Responses API through the tunnel (`tools: [{type: "mcp", tunnel_id}]`) | Not run: the org had no API credits |

## Not yet verified

- Browser approval (`t3mcp auth` without `--approval`). It shares registration, PKCE,
  and code exchange with the tested pairing-code path.
- A recorded launch, follow-up, and interruption driven from a Dot, rather than from
  the local lifecycle test.
- What ChatGPT shows while the tunnel service is stopped.
- ChatGPT's per-call timeout through the tunnel.
