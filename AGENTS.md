# AGENTS.md

If the user asked you to set up T3mcp, or to connect T3 Code to ChatGPT, follow
[docs/agent-setup.md](docs/agent-setup.md).

Working on this repository:

- Node.js 22+, ES modules, no dependencies. `npm test` runs the unit tests.
- Runtime state and secrets live outside the repo (`~/.config/t3mcp`, `~/.local/share/t3mcp`).
  Never commit credentials, tunnel IDs, or account identifiers.
- The ChatGPT plugin source is `plugin/t3-code`; `scripts/build-plugin.mjs` packages it into `dist/`.
- Keep `docs/validation.md` to verified facts, without account-specific IDs.
