# Coding Standards — gemini-cli_context_bonsai

## Authority

Gemini CLI has no `AGENTS.md` / `CLAUDE.md`. Per project rule, this document codifies the standard for new, non-core code. Agent-repo edits inside `gemini-cli` still follow that repo's existing conventions.

## Language / runtime

- TypeScript, `ESNext` / `NodeNext` module resolution, strict mode on.
- Target ES2022 (matches gemini-cli root `tsconfig.json`).
- ESM only. Relative imports use `.js` extensions (matches gemini-cli source convention).
- Node built-ins imported via `node:*` prefix.

## Formatting

Mirror gemini-cli `.prettierrc.json`:

- `tabWidth: 2`
- `semi: true`
- `singleQuote: true`
- `trailingComma: "all"`
- `printWidth: 80`

## Import order

1. Node built-ins (`node:fs`, `node:path`, ...)
2. `@scope/*` third-party and workspace packages
3. Relative imports, with `.js` extension

## Linting

- ESLint with the gemini-cli shared config where possible; otherwise the closest equivalent.
- No `any` unless explicitly justified with a comment.

## Testing

- Vitest harness.
- `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';`
- Colocate tests as `*.test.ts` next to source.
- Mock Gemini CLI packages via `vi.mock('@google/gemini-cli-core', () => ({...}))` pattern.

## File / directory conventions

- `src/mcp-server.ts` — stdio MCP server entry.
- `src/bootstrap.ts` — runtime hook registration helpers (imported by CLI startup).
- `src/guards.ts` — pattern resolution, boundary and same-step guards (pure).
- `src/archive-store.ts` — sidecar archive persistence.
- `src/gauge.ts` — gauge severity band logic (pure).
- `src/placeholder.ts` — structured placeholder rendering.

## Build

- Side repo builds its own MCP server artifact. The Gemini CLI agent repo's MCP bootstrap points `command: process.execPath, args: [<side-repo-artifact-path>]` at that artifact.
