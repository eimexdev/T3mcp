# Validation record

## Environment (2026-10-06, America/Los_Angeles)

- T3 Code server `0.0.46-nightly.20261006.2752` (`t3code.service`, `127.0.0.1:3773`).
  The source was checked against upstream `pingdotgg/t3code` main at
  `bfec2387b8102975c84690f99be0f5f834fd0cbe`, the latest at the time and the same
  commit as the research snapshot. The relevant code is unchanged:
  `apps/server/src/auth/McpOAuth.ts`, `auth/EnvironmentAuth.ts`, `mcp/McpHttpServer.ts`,
  `mcp/McpToolAccess.ts`, `cli/auth.ts`.
- tunnel-client `v0.0.16` (`5f99daabd4aa4a77049e6d81d54a0d8c18335397`), linux-amd64.
  The archive matched `SHA256SUMS.txt`; `gh attestation verify` passed for the
  release workflow's signed provenance.

## T3 behavior confirmed against current source and the live server

- OAuth: protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`.
  Stateless dynamic registration accepts **only** `http://localhost|127.0.0.1|[::1]`
  redirects. PKCE S256, public client, `authorization_code` grant only. Codes last
  60 s and are single use. Issued MCP client sessions last **30 days** with **no refresh token**.
- Access ceilings: `read-only`, `approval-required`, `auto-accept-edits`, `auto`,
  `full-access`. Approval is by an owner browser session or a one-time pairing code.
- External client tokens are accepted only by `/mcp` (not the HTTP API or WebSocket).
  The client has no calling thread; capabilities are orchestration, worktree, and pull-requests.
- Transport: Streamable HTTP. Declares protocol `2025-06-18` and issues
  `Mcp-Session-Id`. `initialize` with `2025-03-26`, `2025-11-25`, or `2026-07-28` is
  answered with `2025-06-18`. A request without a prior `initialize` returns HTTP 400.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Dedicated external credential | Pass | `t3mcp auth --approval mint-pairing-code --access approval-required`: T3 session `2123eec7-de80-40f9-b001-5a7c65259995`, subject `mcp-client`, label *T3 Code (ChatGPT tunnel)*, scopes `orchestration:read orchestration:operate`, expires 2026-11-06T03:30:42Z. Not derived from any provider-session token. |
| Discovery, direct | Pass | `t3mcp check`: server *T3 Code*, protocol 2025-06-18, session issued, 80 tools (25 annotated read-only). |
| Read-only call, direct | Pass | `t3_project_list` returned 5 projects. |
| Stock tunnel-client forwarding with local injection | Pass | `t3mcp check --via-dev-proxy`: `tunnel-client dev proxy` with the production profile shape; client requests carried **no** Authorization header. Same 80 tools; read call succeeded. |
| Catalog and permissions preserved | Pass | Full catalog listed, including internal-only tools. `delegate_task` and `request_secret` were refused with `thread_credential_required`. |
| Launch in disposable workspace | Pass | Through the dev proxy: `t3_thread_launch` `scratch:true`, model `claudeAgent/claude-haiku-4-5`. Thread `mcp:6749dc62-1a82-4c68-ac2a-cd4425d96f3a` in Scratch project `54d3184d-5629-458e-86a3-d31d7332a8c0`. Run `…:ordinal:1` completed; marker read back. |
| Bounded wait and read | Pass | `t3_thread_wait` (30 s steps) → `completed`; `t3_thread_read` messages view contained `T3MCP-653d2f14-LAUNCH-OK`. |
| Follow-up | Pass | `t3_thread_send` mode `queue`, `clientRequestId` set. Run `…:ordinal:2` completed with `…-FOLLOWUP-OK`. |
| Interruption | Pass | Long turn `…:ordinal:3` running; `t3_thread_interrupt` → `interrupt_requested`; wait → `interrupted`. |
| Uncertain-launch handling | Pass | The first launch attempt was rejected (`Pass modelSelection: the project has no default model`). The ledger recorded it, `t3mcp reconcile` searched for the marker and found no thread, and only then was a new launch made. Definite tool rejections are now recorded as `rejected`, separately from lost responses. |
| T3 unreachable behind tunnel-client | Pass (local) | Relay to T3 killed mid-session: the next call got HTTP 502 from tunnel-client within 4 ms, without hanging. |
| tunnel-client doctor on generated profile | Pass | `RESULT ok`. Its MCP probe reports `HTTP 401` because doctor sends no injected header (expected). |
| Unit tests | Pass | `npm test`: 12 tests. |

`validate-lifecycle` reported thread and run IDs as `mcp:6749dc62-…` and
`run:thread:mcp%3A6749dc62-1a82-4c68-ac2a-cd4425d96f3a:ordinal:{1,2,3}`.

## Live setup (2026-10-06, 20:50–21:10 PDT)

| Check | Result | Evidence |
| --- | --- | --- |
| Production credential | Done | Re-approved at `full-access` at the owner's request (T3 session `c3d8b95c-2daa-49a8-a093-8483ab3d5efc`, expires 2026-11-06T03:50Z); the validation credential was revoked. |
| Runtime API key | Done | Created by a Codex sub-agent through the OpenAI Developers connector's encrypted flow: *T3mcp tunnel runtime*, org Personal (`org-e8Wn7PnRPgnicxfsa5vMDnUA`), Default project, no expiry. Written to the secrets file without being displayed. `GET /v1/models` returned 200. |
| Tunnel creation | Owner, in Platform UI | `tunnel_6ac5c36ced108191a39a08de9132f4ac` ("t3 code (bb1)"). The tunnel API returns 403 *Please use an admin API key* for regular keys, and the connector has no tunnel tools. |
| Tunnel/account access | Pass | `t3mcp-tunnel.service` active; tunnel-client fetched tunnel metadata with the runtime key; `/readyz` 200. |
| ChatGPT connection | Pass | Owner created *T3 Code* (Connection: Tunnel, No authentication) and reported it connected. tunnel-client forwarded `initialize`, `notifications/initialized`, and the follow-up list request on the `main` channel; T3 issued MCP session `0bd4fdc6-cf28-4998-a4cf-d22e1a6b4ce8`. ChatGPT did not demand OAuth. |
| ChatGPT permission | Set | A Codex sub-agent changed the app-specific setting for *T3 Code* from "Use my default" to **Allow all actions** (`full_access`). The global default is unchanged. |
| Responses API path | Not run | `insufficient_quota`: the org has no API credits. It failed before the tunnel was used. |
| Plugin archive with skills | Skipped by owner | Imported plugins that declare `mcp.json` are Desktop only, and Plugin Creator does not list the custom MCP plugin as editable. The skill package remains in `plugin/t3-code`. |

## Not yet verified (requires the account owner)

These need the OpenAI Platform tunnel, a runtime key, and the ChatGPT plugin UI.
None existed when V1 was built, and the runtime key cannot be handed to this
machine through chat.

- [ ] Browser approval (`t3mcp auth` without `--approval`). It shares registration,
      PKCE, and code exchange with the tested pairing-code path; only the owner's
      approval page differs.
- [ ] A read-only call from the target Dot.
- [ ] Launch, bounded wait/read, follow-up, and interruption from the Dot (prompts in
      [setup step 7](setup.md#7-verify-from-the-dot)).
- [ ] The error ChatGPT shows while the service is stopped.
- [ ] ChatGPT's per-call timeout through the tunnel (decides practical `timeoutMs` for waits).

Record results here with dates and the thread and run IDs the Dot reports. A native
internal T3 tool call does not count: it uses a different credential and path.
