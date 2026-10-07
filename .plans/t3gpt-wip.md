# T3 access from ChatGPT Dots

Status: tentative WIP, under discussion. Updated 2026-10-06.

Separate phase plans: [V1: one-machine access](v1-single-machine.md), [V2: completion subscriptions](v2-completion-subscriptions.md), and [V3: multiple machines](v3-multiple-machines.md). This file retains discussion notes; the three files define their respective scopes. [Sites feasibility findings](sites-feasibility.md) record the runtime assessment and remaining checks.

Hosting clarification: skipping Sites applies only to V1. V2 may use Sites if it simplifies subscriptions and delivery. After comparing background execution and connection management, V3 now favors direct Cloudflare Workers and Durable Objects. Sites remains a candidate; see its feasibility findings. Actual Dot/Event integration still needs testing.

This records the latest scope and supersedes the broader Sites-first recommendation in RESEARCH.md. No implementation, tunnel, credentials, plugin connection, or test threads have been created.

## Current intent

Let a ChatGPT Dot launch and manage ordinary T3 threads on the user's main machine. Preserve the native MCP catalog rather than building a small replacement tool set. Automatic completion follow-up is desirable, but not required for the first experiment. UI is optional.

Start with one machine. The second machine is a MacBook that is usually offline; do not require installing or running anything on it initially. Avoid Sites, a dashboard, multi-machine onboarding, and T3 Connect client registration in the first scope. The user has end-user T3 access, not access to T3 production infrastructure. V3 would add deliberate machine selection and online/offline handling, with deferred launches an optional separate capability.

## Proposed first experiment

Use a private personal ChatGPT plugin connected through OpenAI Secure MCP Tunnel:

```text
Dot / ChatGPT
  -> OpenAI-hosted tunnel endpoint
  -> tunnel-client on the main machine
  -> existing local T3 /mcp
```

The plugin is the installable connection in ChatGPT. The tunnel client is a background process transporting requests; it is not a browser service worker and does not execute the coding agent. T3 continues to execute and persist all work.

This route may need no custom application server. A locally approved external T3 MCP credential can be injected into the local HTTP hop by tunnel-client. This avoids T3's current restriction to local OAuth callbacks, which prevents a direct ChatGPT OAuth connection. Credentials currently expire after 30 days without a refresh grant, so renewal remains necessary.

Prerequisites to verify: access to Platform tunnel settings and the target ChatGPT workspace, protocol compatibility, discovery, and a read call from the actual Dot. Tunnel access is separate from permission to install a custom plugin. No claim of an end-to-end working connection yet.

If a working, remotely reachable end-user T3 MCP URL is available, a separate reachability daemon is unnecessary. Direct ChatGPT authentication still has the callback incompatibility above; an HTTPS URL by itself does not resolve it. A tunnel the user controls is another transport option, independent of T3 Connect registration.

Sources: [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [local header injection](https://github.com/openai/tunnel-client/blob/master/docs/configuration.md), [T3 OAuth](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/auth/McpOAuth.ts), [personal plugin quickstart](https://developers.openai.com/plugins/quickstart), [Dots plugins](https://learn.chatgpt.com/docs/dots/computers-and-apps).

## Thread updates available today

The inspected T3 source declares MCP protocol 2025-06-18 and does not implement MCP Events subscription methods. Ordinary MCP HTTP/SSE responses are not persistent completion subscriptions.

- t3_thread_read reads saved status, runs, and paginated transcript/activity. afterPosition supports incremental reads.
- t3_thread_wait selects an explicit runId, or the latest run at call time, and waits for a terminal state or timeout. Its implementation subscribes internally to durable run.updated/thread.deleted events rather than repeatedly polling the projection. The MCP result is still one tool response. A timeout does not stop the run.
- The T3 application has a WebSocket orchestration.subscribeThread stream, but external MCP credentials are explicitly rejected outside /mcp. This is not a subscription we can use with that credential. Do not rebuild a full T3 app client for the initial experiment.

A Dot can make bounded wait/read calls while coordinating work. This does not establish a durable subscription or guarantee automatic wake-up after the Dot stops executing. Actual Dot tool timeouts need testing; do not assume T3's maximum wait duration will work through ChatGPT.

Sources: [MCP tools](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/mcp/toolkits/orchestrator/tools.ts), [wait implementation](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/orchestration-v2/ThreadManagementService.ts), [WebSocket subscriptions](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/ws.ts), [credential audience](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/auth/EnvironmentAuth.ts).

## Optional completion events

One V2 candidate is a local stack, subject to a tunnel/event compatibility test. Sites hosting is also in scope; its backend would own subscriptions and delivery while a machine connector forwards T3 calls and reports completion.

```text
Dot -> OpenAI tunnel -> local TypeScript adapter -> native T3 MCP
                           |
                           +-> SQLite subscriptions and pending deliveries
                           +-> bounded T3 wait/read calls for subscribed runs
                           +-> signed HTTPS completion callbacks to ChatGPT
```

The adapter would forward the full T3 tool catalog and handle MCP 2.0 protocol 2026-07-28 on the ChatGPT side. It would implement events discovery, subscribe, and unsubscribe for an initial event such as run.finished. Native T3 can remain on its current protocol.

ChatGPT supplies a callback and signing secret during subscription. The adapter verifies the callback, persists the subscription, watches the specific machine/thread/run, and sends a signed completion event. It then allows the Dot to retrieve the full result through native read tools. Filter by runId, not only threadId, since a thread can run multiple turns.

Persist retries and stable event IDs; recover tracked runs after adapter restart; handle subscription renewal/unsubscribe; distinguish completion, failure, and interruption. Sleeping/offline machines cannot watch or deliver callbacks until they resume, so recover from durable T3 state then. T3's existing inbound scheduler webhooks do not supply outgoing completion subscriptions.

ChatGPT documents MCP Events support for Dots. Event subscriptions and delivery through a private tunnel still need an actual end-to-end test; generic tunnel forwarding alone is not proof of product compatibility. This is a meaningful additional implementation, likely several focused development days for reliable behavior, not a configuration switch.

Source: [MCP Events](https://developers.openai.com/plugins/build/mcp-events).

## UI and MacBook

Official ChatGPT plugin extensions support in-app sidebar apps and conversation panels. MCP Apps also provides inline interactive components. A future thread dashboard can use these without Sites; a local adapter can serve the UI resource through its MCP connection. The inspected T3 MCP server does not register the ChatGPT extension entry points needed for that dashboard. Its own html_render facility is a separate T3-thread capability.

On macOS, OpenAI supports installing tunnel-client through Homebrew. Initially it can run in the foreground for testing; later choose a supported runtime supervisor for the tunnel and a macOS LaunchAgent for a custom adapter, if needed. Neither is a browser service worker. Sleep/offline status means the laptop is unavailable; do not silently redirect a requested laptop job to the main machine. Initial scope needs no laptop service and no machine registry. If a second machine is added, choose between separate personal connections and a unified bridge then.

Sources: [plugin extensions](https://developers.openai.com/plugins/build/extensions), [MCP UI quickstart](https://developers.openai.com/plugins/build/app-quickstart), [tunnel-client macOS installation and supervision](https://github.com/openai/tunnel-client).

## Capability limit to preserve

T3 advertises its full catalog to external clients, but calling-thread tools such as delegate_task, task_status, create_threads, and thread-owned preview/device operations require an internal T3 thread context. A proxy must preserve those refusals. Launching an ordinary thread is supported; that thread's agent can use internal capabilities during its own run. Full catalog forwarding cannot make an external caller equivalent to an agent inside T3.

Source: [T3 tool access](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/mcp/McpToolAccess.ts).

## Next decisions

1. Verify access to OpenAI tunnels and a read-only Dot call against one machine.
2. Decide whether launch/read/wait is sufficient for the first usable version.
3. If automatic wake-up is required, prototype one run.finished subscription before implementing UI or multi-machine support.
4. Validate launches without blind retries: t3_thread_launch has no idempotency key, so retain IDs and reconcile uncertain responses before retrying.

## V3 discussion sketch

One plugin could reach a shared coordinator holding machine records, last-seen/health state, subscriptions, and any deferred launch requests. Native T3 calls would be routed explicitly by machine ID. Per-machine connectors can call local MCP using locally stored T3 credentials and report results to the coordinator over an authenticated outbound connection. This connector is a background process, not a browser service worker.

The preferred first V3 direction for two machines is now direct Cloudflare hosting: a TypeScript MCP endpoint, an owner-scoped Durable Object with SQLite storage, per-machine Cloudflare tunnels to native T3 MCP, and alarms for cloud-side monitoring/retries/expiry. This provides established cloud execution triggers while both personal machines are offline, using cloud-held approved T3 credentials. An outbound WebSocket connector is an alternative if credentials must remain local. ChatGPT calls the hosted endpoint directly, replacing the V1 tunnel connection. Direct hosting requires configuring OAuth, machine routes, deployment, and operational controls. V2's protocol and monitoring code remain reusable; it is not required to remain local.

First add selection and availability, returning last-known state when a machine is unreachable. Later optionally add explicit queue-until-online launches with durable job IDs, expiration, cancellation, and reconciliation before retrying uncertain launches. Losing contact with a machine does not establish that its T3 run stopped. Reconnecting must refresh state and recover completion events. No automatic machine substitution, thread migration, or waking a powered-off laptop is implied.
