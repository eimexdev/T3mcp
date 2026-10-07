# V2: completion subscriptions

Status: tentative WIP. Depends on V1.

Goal: let a Dot subscribe to a launched T3 run and continue when it finishes.

Hosting is open: reuse V1 with a local TypeScript adapter and SQLite, or host the adapter on Sites with its database and a machine connector that forwards native MCP calls and reports completion. Choose based on verified Events support and background delivery, not a preference to avoid Sites.

For Sites, keep persistent run watching on the machine and trigger signed deliveries with connector requests; do not rely on detached Worker loops. See [Sites feasibility](sites-feasibility.md). V2 still covers one machine only.

1. First prove MCP Events discovery, subscription, and a signed callback to an actual Dot through the chosen hosting route. Both private-tunnel Events compatibility and Sites' complete Events support remain unverified.
2. Forward the full native tool catalog and preserve access checks. Handle ChatGPT's MCP 2.0 protocol separately from T3's current protocol.
3. Add one run.finished event filtered by threadId and runId; support subscribe, renewal, and unsubscribe.
4. Detect completion with bounded native wait/read calls. Send a signed summary; let the Dot read the full result through T3 tools.
5. Recover subscriptions and deliveries after restart; retry with stable event IDs and distinguish completion, failure, and interruption.

Done when a subscribed Dot follows up after completion without another user prompt, including after adapter restart and a transient delivery failure.

Deferred: UI, multi-machine routing, and offline launch queues.

Reference: [MCP Events](https://developers.openai.com/plugins/build/mcp-events).
