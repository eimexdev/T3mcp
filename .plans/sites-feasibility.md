# Sites feasibility for T3 subscriptions

Checked 2026-10-06. Documentation/source assessment, not an end-to-end deployed test.

## Assessment

Sites is a feasible candidate for the hosted MCP coordinator, persistent subscriptions, and event delivery when triggered by incoming requests. Long-lived run monitoring belongs in the machine connector. Reliable autonomous retries while every connector is offline require an additional execution trigger whose availability in managed Sites has not been established.

## Established capabilities

- Sites documents HTTP, HTTPS, and WebSockets. It provides D1 for durable records. Its installed reference describes hosted Worker POST /mcp endpoints and platform-managed connection authentication.
- The Sites Worker starter exports fetch(request, env, ctx), so request-driven API endpoints are available. Subscription records, machine state, commands, and a delivery outbox can live in D1 rather than isolate memory.
- Private Sites offer supported service access for non-browser callers. It does not supply a user identity; machine enrollment must separately bind a connector to its owner's authorized records.
- ChatGPT MCP Events uses persistent subscription records and signed outgoing HTTPS callbacks. It does not require maintaining a streaming connection to ChatGPT.

Sources: [Sites documentation](https://learn.chatgpt.com/docs/sites), [installed MCP reference](/home/hermes/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-d/skills/sites/references/site-mcp-server.md), [storage reference](/home/hermes/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-d/skills/sites/references/storage.md), [service access reference](/home/hermes/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-d/skills/sites/references/identity-and-secrets.md), [MCP Events](https://developers.openai.com/plugins/build/mcp-events).

## Worker constraints

Cloudflare does not impose a hard wall-clock duration limit on an HTTP Worker while its client remains connected, subject to other limits and runtime interruptions. That does not make its detached work durable: request-associated tasks may be canceled once the response ends or the client disconnects. waitUntil extends execution only up to 30 seconds after that point. Sites may impose additional gateway limits, so measure actual request deadlines.

Do not start an hour-long thread watcher after returning a tool response, rely on setInterval in isolate memory, or use waitUntil as a persistent scheduler.

Cloudflare itself has Durable Objects, Queues, alarms, and Cron Triggers. The Sites references and hosting contract inspected expose D1/R2 but do not establish provisioning support for those background facilities. This is an unknown, not proof they are forbidden. The Sites create_schedule tool creates a ChatGPT cloud task, not a Worker cron handler or message-queue consumer.

Sources: [Workers duration limits](https://developers.cloudflare.com/workers/platform/limits/#duration), [waitUntil lifecycle](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil), [Sites scheduled updates reference](/home/hermes/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-d/skills/sites/references/recurring-updates.md).

## Proposed design using established capabilities

1. ChatGPT subscribes; Sites verifies the callback and stores the owner's subscription, run filter, protected signing secret, and expiry in D1.
2. An enrolled machine connector polls Sites for commands and watch assignments, with short bounded requests and reconnect backoff. Heartbeats update last-seen and T3 readiness. No inbound machine ports are needed.
3. The connector executes native MCP calls using its local credential, and uses bounded T3 wait/read calls for tracked runs. It stores undelivered reports locally across restart.
4. On completion it POSTs a stable event record to Sites. Sites persists the record and attempts the signed ChatGPT delivery within the request. An acknowledged incoming report is distinct from successful delivery to ChatGPT.
5. Subsequent connector polls drain due deliveries using database claims/leases, stable event IDs, bounded fetch deadlines, and retry backoff. MCP tool calls wait only within tested deadlines; uncertain writes are reconciled, never blindly retried.

This avoids depending on a permanent Worker, WebSocket session affinity, or unverified cloud background bindings. Polling occurs between our connectors and Sites; ChatGPT receives Events through supported webhooks.

If all connectors stop, Sites still accepts and saves requests. Queued jobs wait for their machine; delivery retries wait for another authenticated connector request or a separately supported trigger. Prompt retries independent of all machines would need an additional supported scheduler/queue.

## First implementation checks

- Confirm the Sites-provisioned plugin discovers MCP protocol 2026-07-28 and the Events methods, and that a real Dot can subscribe and receive a signed event.
- Verify supported private service access, expiry/renewal, and per-machine authorization without browser cookies or an authoring-session dependency.
- Measure command round-trip and request timeouts; preserve tool schemas/results, including content blocks, and represent uncertain launch outcomes.
- Verify outbound callback address validation/signing and durable retries after process restart, duplicate reports, and transient callback failures.

Workers are not the fundamental blocker for subscriptions. Managed Sites' complete Events integration remains an unverified product compatibility requirement.
