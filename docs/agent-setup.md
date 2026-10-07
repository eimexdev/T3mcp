# Setup

Connect ChatGPT to T3 Code on this machine. Steps marked **User** happen in the
ChatGPT or OpenAI Platform UI.

1. **Install.**
   ```bash
   git clone https://github.com/eimexdev/T3mcp.git ~/T3mcp && cd ~/T3mcp
   bin/t3mcp.mjs install-tunnel-client
   ```
   Needs Linux with systemd, Node 22+, and T3 Code running at `127.0.0.1:3773`
   (otherwise pass `--t3-url`).

2. **T3 credential.** Ask the user which access level to grant (`full-access` lets
   ChatGPT's threads run without approval prompts), then:
   ```bash
   bin/t3mcp.mjs auth --approval mint-pairing-code --access <level>
   bin/t3mcp.mjs check --via-dev-proxy
   ```

3. **User: create a tunnel** at <https://platform.openai.com/settings/organization/tunnels>
   and share its ID (`tunnel_…`).

4. **Runtime API key.** With Codex's OpenAI Developers plugin, create a key named
   "T3mcp tunnel runtime" and write it to `~/.config/t3mcp/secrets/runtime.env` as
   `CONTROL_PLANE_API_KEY`. Otherwise the user creates one at
   <https://platform.openai.com/settings/organization/api-keys> and runs
   `bin/t3mcp.mjs configure --tunnel-id <id> --runtime-key-stdin`.

5. **Start the tunnel.**
   ```bash
   bin/t3mcp.mjs configure --tunnel-id <id> --runtime-key-env-file ~/.config/t3mcp/secrets/runtime.env
   rm ~/.config/t3mcp/secrets/runtime.env
   bin/t3mcp.mjs service install
   bin/t3mcp.mjs status    # service active, /readyz 200
   ```

6. **User: connect ChatGPT.** Plugins → **+** → **Add custom MCP server**: name
   `T3 Code`, Connection **Tunnel**, Authentication **No authentication** →
   **Create as a plugin** → **Install**.

7. **Optional, permission.** For unattended use, set T3 Code's permission to
   **Allow all actions**, either on the plugin page or with Codex's Plugin
   Management (`update_app_permissions`, `app_id: "T3 Code"`, `full_access`).

8. **Optional, skill and icon.** The user downloads the plugin with **⋯ → Download
   plugin ZIP** and gives it to you. Run
   `scripts/build-plugin.mjs --base <downloaded.zip>`, give the user
   `dist/t3-code-plugin-<version>.zip`, and they upload it with
   **⋯ → Upload new version**.

9. **User: try it.** Enable T3 Code for the Dot and ask: *"Use T3 Code to list my
   T3 projects."*
