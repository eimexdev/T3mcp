# V3: multiple machines and offline handling

Status: tentative WIP. Builds on V2; separate scope from V1 and V2.

Goal: one ChatGPT plugin can select the main machine or MacBook, track availability, and optionally queue launches until a selected machine returns.

Recommended first stack for two machines: TypeScript Cloudflare Workers for MCP/authentication, an owner-scoped Durable Object with SQLite storage for coordination, and Durable Object alarms for run monitoring, delivery retries, and expiry. Each machine runs cloudflared with a separate authenticated route to its native T3 MCP endpoint. The cloud backend stores approved T3 MCP credentials and calls the selected machine over HTTPS. ChatGPT connects directly to the hosted MCP endpoint; the V1 OpenAI tunnel is unnecessary for this hosted connection. No custom machine connector is required for this first transport.

1. Prove OAuth linking and MCP 2.0 Events with a real Dot, one tunneled native MCP connection, and bounded request/result forwarding. Use maintained MCP OAuth components; direct deployment makes authentication and operational setup our responsibility. Keep machine credentials protected and account for T3's 30-day credential renewal.
2. Preserve the full native T3 catalog and permissions. Add list_machines and per-call machine selection; retain machine/thread/run IDs together and account for per-machine tool versions.
3. Store machine routes, observed reachability/T3 readiness, pending commands, subscriptions, and undelivered events in Durable Object SQLite. Probe native MCP with bounded authenticated calls; an unreachable machine has last-known state, not a confirmed power state. Do not rely on isolate memory surviving.
4. Use alarms to make bounded native read/wait calls for subscribed runs, persist terminal transitions, send signed callbacks, and process due deliveries/expiry. Reschedule remaining work, including after a downstream outage exhausts automatic alarm retries. Stable event IDs suppress duplicates; alarms are at-least-once.
5. Return explicit unavailable/last-known status when a machine disconnects. On reconnection, reconcile active runs and recover missed events.
6. Optionally add explicit queue-until-online launches with job IDs, expiry, cancellation, and reconciliation before retrying uncertain launches. Never silently substitute another machine.

Done when both machines are selectable, an offline MacBook remains visible, reconnection restores monitoring, and an explicitly queued job starts on its intended machine once ready.

Cloud hosting remains reachable and can retry already-observed events while both machines are offline. Unobserved machine-side results become known once that machine is reachable again. A cloud job queue does not wake a powered-off laptop.

Alternative: Sites can host a request-driven coordinator; see [Sites feasibility](sites-feasibility.md). Its managed authentication/provisioning is convenient, but background bindings remain unverified. Direct Cloudflare is preferred for V3's connection and retry requirements. For two machines, start with Durable Object storage and alarms; add D1 or Cloudflare Queues only if needed.

Transport alternative: if T3 credentials must remain on each machine, use a custom TypeScript connector with an authenticated outbound WebSocket to the Durable Object and local wait/read monitoring. Hibernation supports cloud-side idle connections; connectors still need reconnect and persisted-report recovery. This adds custom device software but removes the need for per-machine HTTP tunnels and cloud-held T3 credentials.

Deferred: UI, automatic machine wake-up, and thread migration. The complete plugin flow must be tested before treating this design as deployed or proven.

References: [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/), [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [SQLite storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/), [MCP OAuth support](https://developers.cloudflare.com/changelog/post/2026-10-01-workers-oauth-provider-1x/).
