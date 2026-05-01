# Development

This repo contains Gemini CLI Context Bonsai side logic: hook helpers, an MCP server, archive state, guards, placeholders, and gauge rendering.

## Source Of Truth

Shared behavior is defined in the main Context Bonsai spec. Update the spec first for behavior changes, then update this package and the Gemini CLI harness integration.

## Implementation Notes

- `src/index.ts` exports hook registration helpers, constants, schemas, and runtime utilities.
- `src/bootstrap.ts` wires guidance and before-model behavior through a host adapter.
- `src/mcp-server.ts` exposes the MCP tools.
- `src/archive-store.ts` persists archive metadata.
- `src/mcp-server-path.ts` gives the built MCP server path for the harness to launch.

The MCP server is state-oriented. Gemini CLI integration must translate harness messages, resolve boundaries, and apply transcript transforms.

## Commands

```sh
npm run build
npm run typecheck
npm test
```

`STANDARDS.md` contains coding standards for this repo.

## References

- Main project README: https://github.com/Vibecodelicious/context-bonsai-agents
- Shared spec: https://github.com/Vibecodelicious/context-bonsai-agents/blob/main/docs/context-bonsai-agent-spec.md
- Gemini CLI spec: https://github.com/Vibecodelicious/context-bonsai-agents/blob/main/docs/agent-specs/gemini-cli-context-bonsai-spec.md
