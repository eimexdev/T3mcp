# ChatGPT controlling threads on a T3 Code machine

Research date: 2026-10-06, America/Los_Angeles.

## Findings and recommendation

This is feasible. T3's external MCP client support provides the thread operations needed for your idea. The main gap is authentication compatibility with ChatGPT, rather than thread orchestration. [Launch implementation](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/mcp/toolkits/project/handlers.ts), [thread tools](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/mcp/toolkits/thread/tools.ts).

The user's clarified goal is an owner-private Sites plugin for ChatGPT Dots that preserves the full native T3 MCP tool catalog and adds machine discovery and optional thread UI. Sites handles ChatGPT's OAuth; the Site backend holds a dedicated, approved T3 MCP client credential. Threads execute and persist on the selected machine, and later ChatGPT calls use their IDs to retrieve progress or send follow-ups. Use a reachable end-user MCP URL, or a Cloudflare tunnel the user controls, without requiring T3 production access or new T3 Connect client registrations.

For an experiment on one machine, OpenAI Secure MCP Tunnel is worth testing first. Its client can inject the T3 credential locally, so a separate Site might be unnecessary. This depends on tunnel access for your personal account and successful protocol negotiation with T3.

The direct T3 Connect URL is not currently a working OAuth connection for ChatGPT. T3 accepts only loopback callback URLs, while ChatGPT requires an HTTPS callback on its own domain. T3 would need a trusted hosted-client registration path, or you need the bridge/token-injection paths above.

| Approach | Additional implementation | Current assessment |
| --- | --- | --- |
| Private Site -> reachable native MCP URL | Full catalog forwarding, machine routing, downstream credential setup and renewal | Recommended for your plugin; source-supported, not tested end to end |
| ChatGPT Secure MCP Tunnel -> local native MCP | Tunnel setup and local injection of an approved T3 MCP credential | Smallest personal experiment; access and compatibility need verification |
| ChatGPT -> T3 Connect -> native MCP OAuth | T3 change for trusted ChatGPT callbacks | Blocked by the current redirect restriction |
| Rebuild a T3 client like T3 Poll | Pairing, client authentication and typed WebSocket integration | Possible, but more machinery than the native MCP route |
| T3 scheduler webhook | Preconfigured task and trigger URL | Useful for incoming events; does not supply the thread-management connection |

A first plugin should forward the full discovered T3 tool catalog, preserving native parameters and responses, and add machine discovery and routing. An outside client supplies explicit project and thread targets; it does not need a preexisting parent thread. Catalog visibility does not grant execution access: it cannot use tools that act as a running parent thread, such as native delegation. The launched T3 agent can still use those tools within its own run. [Tool access rules](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/mcp/McpToolAccess.ts).

For multiple machines, the same Site can maintain an owner-authorized mapping of machine IDs to HTTPS MCP endpoints and credentials. Each machine needs its own enrollment. T3's existing client-side load balancing is not automatically inherited by a hosted bridge.

## Research scope

I used an Opus 5.5 research child for the T3 source, Connect and deprecated T3 Poll investigation, and checked the ChatGPT/Sites side separately. The source baseline is fetched upstream main at `bfec2387b8102975c84690f99be0f5f834fd0cbe`. The main checkout and running T3 configuration were left in place. The installed server is `0.0.46-nightly.20261006.2752`; its release tag contains the OAuth change, and live metadata and rejected-registration probes confirm that the server has it. The local source checkout is older than that installed binary.

No Site, plugin, tunnel, credential, scheduler task, or test thread was created as part of this research. Live checks used unauthenticated metadata requests, an unauthenticated MCP request, and a rejected stateless client-registration request. No end-to-end authenticated plugin connection was tested.

Relevant merged changes are [tool access declarations, #16335](https://github.com/pingdotgg/t3code/pull/16335), [external MCP OAuth, #16336](https://github.com/pingdotgg/t3code/pull/16336), and [copy MCP URL, #16337](https://github.com/pingdotgg/t3code/pull/16337).

## ChatGPT and Sites findings

Checked 2026-10-06 against official OpenAI documentation and the installed Sites capability reference.

ChatGPT can turn a remote MCP server into a personal plugin with read and write tools. A tools-only plugin does not need a custom UI. Connect it through Plugins, install it, and invoke it with an @ mention. This establishes a supported way to call a bridge from ChatGPT. [Custom MCP servers](https://developers.openai.com/api/docs/guides/custom-mcp-server), [plugin quickstart](https://developers.openai.com/plugins/quickstart).

Dots documentation says dots run in the cloud with their own computer and browser and can use supported plugins installed and enabled for the user's account. The personal-plugin quickstart establishes that a custom MCP server can become an installed personal plugin. Together these support the proposed private hosted plugin route; the actual custom plugin still needs an end-to-end Dot tool-call test, and account/workspace permissions apply. This does not require installing a local MCP process inside the Dot's cloud computer. [Dots computers and apps](https://learn.chatgpt.com/docs/dots/computers-and-apps), [personal plugin quickstart](https://developers.openai.com/plugins/quickstart).

MCP, plugins, and UI extensions are layers of the same integration. MCP defines server-backed tools and optional UI resources; a plugin is the installable package; MCP Apps supplies interactive UI, and OpenAI extensions add sidebar and conversation-panel entry points. A thread dashboard can call the same tools and poll while open without MCP Events. The Dot must be able to use tools without an open UI. Specific Sites support for UI resource methods and extension metadata needs a small compatibility test before committing to those entry points. [Plugin architecture](https://developers.openai.com/plugins/concepts/plugins), [MCP server and UI quickstart](https://developers.openai.com/plugins/build/app-quickstart), [plugin extensions](https://developers.openai.com/plugins/build/extensions).

The direct OAuth connection has a concrete incompatibility. ChatGPT uses an HTTPS callback on `chatgpt.com`; T3's newly merged registration and authorization code accept only HTTP loopback redirects. DCR and PKCE support alone do not overcome that restriction. OpenAI also documents that ChatGPT cannot present a custom API key. A public tunnel to an unchanged T3 endpoint therefore does not complete ChatGPT's sign-in flow. [OpenAI authentication](https://developers.openai.com/plugins/build/auth), [T3 OAuth implementation](https://github.com/pingdotgg/t3code/blob/2c8be5893eb3754071162e344a8c8e8a67bef597/apps/server/src/auth/McpOAuth.ts).

### Sites as the bridge

The installed Sites reference supports a stateless `POST /mcp` endpoint with initialization, discovery, and tool calls. Adding `mcp` to hosting capabilities provisions an app and private plugin when publishing. Sites manages the connection's OAuth. Server code must still authorize data and actions against the request identity. Runtime secrets keep the downstream T3 credential out of browser code. The runtime is hosted, so it needs a reachable HTTPS machine endpoint; its `localhost` is not your computer. [Site MCP reference](/home/hermes/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-d/skills/sites/references/site-mcp-server.md), [Sites identity reference](/home/hermes/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-d/skills/sites/references/identity-and-secrets.md), [Sites runtime](/home/hermes/.codex/plugins/cache/openai-curated-remote/sites/1.0.0-d/skills/sites/SKILL.md).

Proposed connection:

```text
ChatGPT personal plugin
  -> owner-private Site /mcp, with Sites-managed OAuth
  -> server-side HTTPS MCP request with an approved T3 MCP bearer
  -> machine's existing T3 Connect endpoint /mcp
  -> T3 launches and persists the thread on that machine
```

This is a source-supported design, not a connection that was deployed or tested during this research. It avoids changing T3 and does not require recreating T3's WebSocket client. A setup helper would perform the supported local-callback T3 OAuth flow once and place the resulting MCP credential in the Site's runtime secrets. T3 grants last 30 days and this implementation does not issue refresh tokens, so renewal must be part of setup and maintenance. Use a dedicated MCP client credential rather than borrowing a running agent's temporary provider-session token.

Cloudflare Tunnel can supply an HTTPS route to a local service when T3 Connect is unavailable. Cloudflare Access service tokens add a separate authentication layer using request headers, which a Site backend can send. They do not replace T3's own MCP credential. [Cloudflare routing](https://developers.cloudflare.com/tunnel/concepts/routing/), [service authentication](https://developers.cloudflare.com/cloudflare-one/access-controls/authenticate-agents/).

### Smaller personal alternative

OpenAI Secure MCP Tunnel can expose a private MCP server to a personal ChatGPT plugin through an outbound daemon on the machine. It requires a Platform tunnel, runtime key, and the relevant organization/workspace access. This tunnel is for private connections, not public plugin distribution. [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

Its official client supports static backend headers, including values read from a local environment variable or file. Those values are added on the local MCP hop. A previously approved T3 MCP credential can therefore authenticate the downstream request while the ChatGPT connector uses No authentication behind the restricted tunnel. The runtime key authenticating the tunnel to OpenAI is a separate credential. [Tunnel configuration](https://github.com/openai/tunnel-client/blob/master/docs/configuration.md), [credential boundaries](https://github.com/openai/tunnel-client/blob/master/docs/architecture.md).

Proposed configuration fragment, to validate against the installed client's help before use:

```yaml
config_version: 1
control_plane:
  tunnel_id: tunnel_REPLACE_WITH_REAL_ID
  api_key: env:CONTROL_PLANE_API_KEY
mcp:
  server_urls:
    - channel: main
      url: http://127.0.0.1:REPLACE_WITH_T3_PORT/mcp
  extra_headers:
    Authorization: file:/absolute/private/path/t3-mcp-authorization-header
```

The referenced file holds the full `Bearer <approved T3 MCP token>` header value. This is a design example only; no credentials were minted, no daemon was installed, and no tunnel was created. Validate handshake compatibility, discovery, and one read call before attempting a launch. If a released client cannot negotiate T3's protocol, a local compatibility adapter remains an option.

### Completion notifications

Checking a thread through tools is enough for the initial version. For automatic follow-up, ChatGPT also documents MCP Events in Work cloud chats. An event server stores subscriptions and posts signed completion events to ChatGPT callbacks. It requires protocol `2026-07-28`; T3 currently declares `2025-06-18`. This would be additional bridge work, with a durable event producer, rather than an ability supplied by T3's existing inbound scheduler webhook. Sites support for the complete event flow still needs verification. [MCP Events](https://developers.openai.com/plugins/build/mcp-events), [T3 transport](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/mcp/McpHttpServer.ts).

## Recommended first implementation

For a maintained plugin with a machine dashboard, use an owner-private Site and a reachable end-user MCP address. A user-controlled Cloudflare tunnel is an alternative when the end-user address is loopback-only. Forward the complete discovered tool catalog and preserve T3's access refusals. Add `list_machines`, explicit per-call machine routing, and a default for the initial single machine. Keep the native `threadId`, `runId`, and timeline cursor in tool responses, together with the machine ID. Start with one manually enrolled machine, while recording endpoints and credential references per machine so additional enrollment does not require redesigning the tools. Multi-machine credentials, offline behavior, and different T3 tool/schema versions require additional implementation. MCP Events are deferred by user preference.

For the quickest single-machine experiment, test Secure MCP Tunnel with an approved T3 token injected locally. This might eliminate the bridge entirely, but the personal account's tunnel access and actual protocol compatibility still need testing.

A direct ChatGPT-to-T3 Connect plugin becomes possible if T3 adds a trusted ChatGPT callback registration path. That should explicitly allow the relevant OpenAI client and exact callback rather than accept arbitrary HTTPS callbacks, because T3's restriction was deliberately introduced to prevent approval-link phishing. Source review supports this direction; it is not an implemented change.

Whichever path is chosen, persist the launch response and reconcile uncertain launches before retrying. The native launch call has no idempotency key, so a timeout can otherwise start duplicate work. A bridge's request-key record helps, but cannot atomically commit a launch across the network; it must represent uncertain outcomes and reconcile them. Follow-up messages can use native `clientRequestId` support.

The host must be online with T3 and its providers running. A tunnel makes a running server reachable; it does not itself boot an offline machine. Before shipping, prove the full path with a harmless launch in a disposable project, a read from a new ChatGPT conversation, a follow-up, interruption, and credential revocation.

## T3 source details and live checks

### What merged and what is installed

The fetched source includes all three external-agent changes merged on October 6. The source checkout remains at `9503155`, 40 commits behind fetched upstream. Its `origin` is the older `eimexdev/t3code` fork, so research used `upstream`, the `pingdotgg/t3code` repository. The installed release is newer than the checkout. Its tag contains the OAuth change, and the running endpoint returned the expected OAuth metadata.

Unauthenticated local probes against port 3773 established:

- Protected-resource metadata identifies `/mcp` and the orchestration read/operate scopes.
- Authorization metadata offers PKCE S256, public-client code exchange, and dynamic registration.
- An unauthenticated MCP initialize request returns 401 with an OAuth discovery challenge.
- Registration with `https://chatgpt.com/connector_platform_oauth_redirect` returns `invalid_redirect_uri`. This registration path is stateless, and the rejected probe created no session.

These checks establish the installed auth behavior. They do not establish that a ChatGPT plugin can complete an authenticated connection or that the public tunnel hostname was tested from another network.

### Transport and caller identity

T3 serves `/mcp` over Streamable HTTP and explicitly declares protocol `2025-06-18`. The same route accepts temporary provider-session tokens and external OAuth MCP client tokens. An outside caller has a client session and permission ceiling, with no parent thread or provider session. It can act without a running parent turn. [MCP transport](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/mcp/McpHttpServer.ts#L843)

An outside client supplies explicit project/thread IDs where an internal agent would inherit them. Its token is accepted only by `/mcp`; it cannot use that token for the general HTTP API or WebSocket RPC. The token appears as a client in Connections and can be revoked. [External client credentials](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/auth/EnvironmentAuth.ts#L1175)

### Tools for the first plugin

| User operation | Native tool | Relevant behavior |
| --- | --- | --- |
| Find a workspace | `t3_project_list`, `t3_project_read` | Registered projects on this environment |
| Choose a provider/model | `orchestrator_capabilities` | Uses the live provider catalog |
| Start work | `t3_thread_launch` | Explicit `projectId`, or `scratch:true`; returns `threadId` and possibly `runId` |
| Find prior work | `t3_thread_list`, `t3_thread_search` | Use explicit project targets |
| Check progress/results | `t3_thread_read` | Durable runs and transcript; incremental `afterPosition` cursor |
| Wait briefly | `t3_thread_wait` | Specify a short timeout and retain the run ID |
| Continue or steer work | `t3_thread_send` | `auto`, `queue`, `steer`, or `restart`; supports `clientRequestId` |
| Stop a run | `t3_thread_interrupt` | Targets a thread and optional run ID |
| Answer a user question | `t3_pending_request_list/read/respond` | Does not list or approve permission requests |

Launch can select the project root, a new worktree with a base ref, or an existing project worktree. T3 binds the workspace before the agent starts. It uses the project's default model if an outside caller does not choose one. Launch acceptance can precede worktree preparation, so read the returned thread to distinguish preparation from a running agent. [Launch handler](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/mcp/toolkits/project/handlers.ts#L55)

The read tool supports message and activity views, item limits, text limits, pagination, and long-text recovery. Reading a result later does not depend on keeping the original ChatGPT conversation or MCP HTTP connection open. Keep the environment/machine ID with the native thread ID in the bridge. [Thread contracts](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/packages/contracts/src/orchestratorMcp.ts#L336)

The native wait defaults to ten minutes, with a maximum of sixty. A timeout does not stop the run. Use bounded waits, for example 30 seconds initially, and adapt to the actual ChatGPT tool timeout during testing. The exact ChatGPT timeout was not verified here. [Wait implementation](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/mcp/OrchestratorMcpService.ts#L1866)

For retries, retain the same `clientRequestId` for the same send operation. Launch has no retry key. A bridge must reconcile uncertain launches; matching a title alone is not a uniqueness guarantee. [Send contract](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/packages/contracts/src/orchestratorMcp.ts#L418)

Read-only client grants cannot mutate state. Other grants limit the runtime modes of threads they launch or target. A supervised grant cannot send to or interrupt an existing full-access thread. If managing your current full-access work is part of the plugin, its approved ceiling must cover those threads. User-input response tools cannot approve permission requests; supervised runs can still require action in T3's UI. [Caller access rules](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/mcp/McpToolAccess.ts#L100) [User question tools](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/mcp/toolkits/thread/tools.ts#L147)

`delegate_task`, `task_status`, `task_cancel`, `create_threads`, `request_secret`, and thread-owned preview/device/HTML operations require an internal caller. They are unnecessary for launching ordinary top-level work from ChatGPT. A launched T3 agent can delegate within its own turn. The MCP tool catalog is not filtered for outside clients, so a bridge should expose the tools that actually fit this workflow. [Caller access rules](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/mcp/McpToolAccess.ts#L100)

### Credential setup

The helper registers a localhost callback, generates a PKCE verifier/challenge, opens T3's authorization URL, receives the user's approval at the callback, and exchanges the code. Approval comes from a signed-in administrative browser or a suitable one-time pairing code. The resulting credential is a portable bearer token, with the permission ceiling the user chose. It can be obtained locally and then used by a hosted Site. [OAuth code and token flow](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/auth/McpOAuth.ts#L307) [External client credentials](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/auth/EnvironmentAuth.ts#L1175)

The code lasts sixty seconds and is single use. The issued client credential lasts thirty days. The server supports authorization-code exchange only and issues no refresh token. Renewal should repeat the approved flow. Do not use a temporary credential belonging to this research agent or another active T3 provider session. [OAuth code and token flow](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/auth/McpOAuth.ts#L307)

### T3 Connect and the old client approach

T3 Connect manages Cloudflare tunnel allocation. After bootstrap, clients connect directly to the environment's tunnel hostname rather than proxying ordinary requests through the relay Worker. The managed tunnel forwards to T3's own loopback server. The MCP and OAuth URLs use the request origin, so the native endpoint is designed to work through the Connect route. The UI's Copy MCP URL action includes this route. [Connect architecture](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/docs/internals/t3-connect.md#L3) [MCP URL selection](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/packages/client-runtime/src/connection/presentation.ts#L95)

The managed tunnel does not automatically expose a separate bridge process on another port. A hosted Site can call the existing T3 tunnel, while an on-machine bridge needs its own ingress or Secure MCP Tunnel. Tailscale Serve is private to the tailnet; a cloud-hosted ChatGPT MCP caller cannot reach it without an additional supported network path. [Connect architecture](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/docs/internals/t3-connect.md#L3)

A T3-managed tunnel process is running on this machine. The research did not read its credential files or extract its public hostname. Reachability through that hostname remains a setup test.

Connect's own client enrollment uses cloud identity and proof-bound bootstrap credentials. T3 refuses those credentials for MCP approval. The native external MCP client route already supplies the narrower client identity needed here. Rebuilding Connect enrollment would add work without supplying a missing thread operation. [Connect architecture](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/docs/internals/t3-connect.md#L3) [OAuth code and token flow](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/auth/McpOAuth.ts#L307)

The old T3 Poll checkout is `eimexdev/t3poll` at `730abc02d8793f54b388078beca973eb1e9152d5`. Its setup issued an administrative bearer through the auth CLI. It read the orchestration shell and wrote through `/api/orchestration/dispatch`. That dispatch endpoint was removed by commit `de343914273eceb852a1d1d739cd1d38df7796ee` on October 2. Current writes use WebSocket RPC or native MCP. [Old setup](https://github.com/eimexdev/t3poll/blob/730abc02d8793f54b388078beca973eb1e9152d5/src/setup.ts#L242), [old transport](https://github.com/eimexdev/t3poll/blob/730abc02d8793f54b388078beca973eb1e9152d5/src/t3.ts#L72), [dispatch removal](https://github.com/pingdotgg/t3code/commit/de343914273eceb852a1d1d739cd1d38df7796ee).

### Why scheduler webhooks do not replace MCP

A scheduler webhook renders a preconfigured prompt using request placeholders and then starts a new thread or queues a message into its configured thread. It returns `202` with a `deliveryId` and outcome header, with no thread ID or output. It does not offer read, wait, steer, or interrupt operations. [Webhook response](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/scheduledTasks/webhookRoute.ts#L116)

An outside MCP caller can create a webhook task with an explicit project, but cannot bind it to its nonexistent calling thread. Incoming deliveries therefore create fresh top-level threads in that case. A configured `{{body}}` prompt could accept arbitrary task text, but choosing and following individual threads would still need a separate management connection. [Webhook dispatch and limits](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/scheduledTasks/ScheduledTaskService.ts#L778)

The service limits accepted deliveries to sixty per task per minute and twenty queued/running deliveries. The relay can hold opted-in deliveries for up to twenty-four hours while the environment is offline. These are useful event-ingestion semantics, rather than the interactive control workflow requested here. [Webhook dispatch and limits](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/apps/server/src/scheduledTasks/ScheduledTaskService.ts#L778) [Connect architecture](https://github.com/pingdotgg/t3code/blob/bfec2387b8102975c84690f99be0f5f834fd0cbe/docs/internals/t3-connect.md#L3)
