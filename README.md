# gemini-cli_context_bonsai

Side project for the Context Bonsai Gemini CLI port. Hosts the MCP server, runtime hook-registration library, guards, archive store, and gauge logic. The Gemini CLI agent repo only receives narrow capability-enabling seams (structured hook translator, MCP bootstrap, minimal startup wiring).

## Scope

- `src/` — MCP server binary + runtime registration helpers + pure-logic modules
- `test/` — side-repo tests (vitest)
- `docs/` — project docs (story plan reference, standards, design notes)
- `STANDARDS.md` — coding standards authoritative for this side repo

## Related

- Parent planning repo: `context-bonsai-agents`
- Agent repo (narrow seams only): `gemini-cli`
- Story plan: `.agents/plans/epic-context-bonsai-agent-ports/story-context-bonsai-agent-ports.2-gemini-hooks-plus-mcp.md` (in parent repo)
