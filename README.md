# Gemini CLI Context Bonsai

> Warning: This Context Bonsai implementation has not yet been tested with its target agent harness.

Context Bonsai side package for Gemini CLI.

For the shared explanation of Context Bonsai, see the main project README: https://github.com/Vibecodelicious/context-bonsai-agents

## Installation

This repo is not a standalone Gemini CLI plugin. It provides hook helpers and an MCP server that must be wired into the Gemini CLI harness.

Add it as a dependency from Gemini CLI during local integration:

```json
{
  "dependencies": {
    "gemini-cli-context-bonsai": "file:../gemini-cli_context_bonsai"
  }
}
```

Build the package before the harness launches the MCP server:

```sh
npm run build
```

The Gemini CLI harness must register the Bonsai hooks, launch the built MCP server, provide `CONTEXT_BONSAI_BASE_DIR` and `CONTEXT_BONSAI_SESSION_ID`, and translate Gemini messages into the side package's archive/placeholder flow.

## Usage

The MCP server exposes:

- `context-bonsai-prune`
- `context-bonsai-retrieve`

The current MCP server stores archive state. The harness integration is responsible for resolving transcript patterns and applying transcript transforms.

## How This Is Implemented For Gemini CLI

The package exports hook registration helpers, MCP server path helpers, archive store utilities, guards, placeholder rendering, and gauge text. The Gemini CLI harness is responsible for connecting those pieces to the live request pipeline.

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).

```sh
npm run build
npm run typecheck
npm test
```
