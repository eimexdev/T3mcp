# V1: one-machine access

Status: implemented in this repository (T3mcp); local validation complete. End-to-end tunnel and Dot verification is pending the account owner's Platform and ChatGPT steps. See [README](../README.md), [setup](../docs/setup.md), and [validation](../docs/validation.md).

Goal: let a ChatGPT Dot use the native T3 MCP tools on the main machine.

Stack: personal ChatGPT plugin -> OpenAI Secure MCP Tunnel -> tunnel-client on the main machine -> existing T3 MCP. Inject a dedicated, locally approved T3 MCP credential on the local hop.

1. Verify tunnel/account access, authentication, protocol compatibility, and a read-only call from the actual Dot.
2. Preserve the complete native catalog and T3's permission checks.
3. Verify launch, bounded wait/read, follow-up, and interruption in a disposable workspace. Retain launch IDs; reconcile lost responses before retrying.
4. Arrange supported background supervision and credential renewal.

Done when a Dot can launch work and retrieve its result, and an unavailable machine produces a clear failure.

Deferred: automatic completion notifications, custom adapter, Sites, UI, second machine, and offline queues.

## Setup and portability

- A setup agent needs a terminal on the main machine, or SSH access, with permission to install/configure the tunnel client and a background supervisor. Native T3 tools, Sites tools, and this agent's other integrations are optional conveniences.
- The owner needs Platform tunnel access, an associated ChatGPT workspace, permission to install the personal plugin, and a T3 approval browser session. The OpenAI tunnel runtime key and the approved T3 MCP token are separate credentials; store both privately.
- Obtain the T3 token through its local OAuth approval flow. A small one-time setup helper may be needed to register a loopback callback and exchange the approval code. Never reuse an agent's temporary provider-session token. The inspected T3 version requires renewal after 30 days and supplies no refresh token.
- Configure tunnel-client's HTTP target to the machine's native `/mcp` endpoint, with local credential injection for calls and discovery/probes. Test ChatGPT's No authentication option for this private tunnel connection; T3 still receives its approved bearer locally. Confirm discovery and protocol negotiation before claiming compatibility.
- In ChatGPT, create a custom MCP plugin using Connection: Tunnel, select the tunnel, install it, and enable it for the actual Dot. Its cloud computer needs no installation on the main machine.
- Validate through the external credential and actual Dot. An internal T3 tool call from the setup agent does not prove external access. The catalog remains complete, but internal-thread-only tools remain unavailable to an external caller.

References: [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [custom MCP plugin setup](https://developers.openai.com/api/docs/guides/custom-mcp-server), [local header configuration](https://github.com/openai/tunnel-client/blob/master/docs/configuration.md), [research](../RESEARCH.md).
