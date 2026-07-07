# Gemini CLI Context Bonsai

Context Bonsai support for [Gemini CLI](https://github.com/google-gemini/gemini-cli).

**Status: not yet validated.** The integration code and the install steps below exist, but no end-to-end run against a live Gemini CLI has been performed — running one needs a Gemini credential, and that validation hasn't happened yet. Every other Context Bonsai port has a dated live-verification record; this one does not. Until it does, treat this repo as work in progress rather than a working port. The main project README lists the ports that are verified: https://github.com/Vibecodelicious/context-bonsai-agents

For the shared explanation of Context Bonsai, see the main project README: https://github.com/Vibecodelicious/context-bonsai-agents

## Architecture note

Gemini CLI's Context Bonsai integration is delivered as a matched pair: a Gemini CLI fork that carries narrow integration patches (hook registrations, MCP server injection, transcript snapshot helper) and this side package, which provides the MCP server, hook helpers, archive store, and placeholder rendering. They are tracked as submodules of a coordination repo.

## Installation

### Prerequisites

- Node.js 20 or newer, and `npm`. Confirm with `node --version` and `npm --version`.
- `git`.
- A Gemini-compatible credential already configured on your machine (Sign-in with Google, `GEMINI_API_KEY`, or Vertex AI). This README does not cover provider setup; see Gemini CLI's own documentation.

### Clone the parent repository

```sh
git clone https://github.com/Vibecodelicious/context-bonsai-agents.git
cd context-bonsai-agents
git submodule update --init gemini-cli gemini-cli_context_bonsai
```

After this you'll have:

- `gemini-cli/` — the Gemini CLI fork.
- `gemini-cli_context_bonsai/` — this side package.

The relative position of these two directories matters: `gemini-cli/packages/cli/package.json` references this side package as `file:../../../gemini-cli_context_bonsai`. The submodule layout above is what that path resolves to.

### Build the side package

```sh
cd gemini-cli_context_bonsai
npm install
npm run build
cd ..
```

This produces `gemini-cli_context_bonsai/dist/index.js` and `dist/mcp-server.js`. The Gemini CLI build resolves the side package as a `file:` dependency and will fail to bundle if these files are missing.

### Build the Gemini CLI fork

```sh
cd gemini-cli
npm install
cd ..
```

The Gemini CLI root `prepare` script runs `npm run bundle` automatically during `npm install`, producing the runnable bundle at `gemini-cli/bundle/gemini.js`. No separate build step is required.

### Launch the bonsai-integrated Gemini CLI

Define a shell function so you can launch the bonsai-integrated build from any directory, leaving any existing `gemini` install in place:

```sh
gemini_bonsai() {
  node /absolute/path/to/context-bonsai-agents/gemini-cli/bundle/gemini.js "$@"
}
```

Replace `/absolute/path/to/` with the real path on your machine. Add the function to `~/.bashrc`, `~/.zshrc`, or your shell's equivalent so it persists across sessions, then `source` that file or open a new terminal. The name `gemini_bonsai` is just an example — choose any name that does not collide with your existing `gemini`.

### Verify the integration

Run the following from any directory:

```sh
gemini_bonsai --version
```

This should print the Gemini CLI version. If this prints a version, the bundle was produced successfully and resolved the side package as a `file:` dependency.

Then confirm that bonsai code is actually inside the bundle:

```sh
grep -l "context-bonsai" /absolute/path/to/context-bonsai-agents/gemini-cli/bundle/chunk-*.js
```

This should list one or more chunk files. An empty result means the side package was not built before `gemini-cli` was installed; rerun the side-package build step and reinstall `gemini-cli`.

Finally, start Gemini CLI interactively:

```sh
gemini_bonsai
```

Complete the provider sign-in if prompted, then send the prompt:

```
list your tools
```

The response should include the Gemini MCP-prefixed tools `mcp_context-bonsai_context-bonsai-prune` and `mcp_context-bonsai_context-bonsai-retrieve` among the available tools.

## Usage

Once loaded, Gemini CLI exposes two model-facing tools. The side MCP server names are:

- `context-bonsai-prune`
- `context-bonsai-retrieve`

Gemini CLI displays them to the model with its MCP prefix, such as `mcp_context-bonsai_context-bonsai-prune`.

The model decides when to use those tools based on injected guidance and context-pressure reminders. Pruned ranges are hidden from active model context and replaced with placeholders. Retrieval restores archived ranges.

## Security disclosure

- **What the integration reads.** The active Gemini CLI session transcript (via the chat recording service) to resolve prune patterns to message ids and to render placeholder turns before each model request.
- **Where archive state persists on disk.** The MCP server writes a sidecar JSON file under Gemini CLI's per-project temp directory (`~/.gemini/tmp/<project-hash>/`), scoped to the running session id. No other locations are written.
- **What is transmitted to the LLM provider.** Placeholder summaries and index terms generated for archived ranges are visible in the active transcript and therefore reach the model in subsequent turns. Archived original content is hidden from the active transcript and is NOT transmitted to the model unless an explicit `context-bonsai-retrieve` call restores it.
- **Network egress.** The integration does not initiate network calls separately from Gemini CLI. The bonsai MCP server is a local stdio child process; all model traffic goes through Gemini CLI's existing provider configuration.

## Uninstall

1. Remove the `gemini_bonsai` shell function from your shell rc file (and `source` the file or open a new terminal).
2. Optionally remove the cloned coordination repo:
   ```sh
   rm -rf /absolute/path/to/context-bonsai-agents
   ```
3. Optionally remove persisted archive state for past sessions:
   ```sh
   rm -rf ~/.gemini/tmp
   ```
   This also removes other Gemini CLI per-project temp data; only do this if you intend to clear that as well.

Your pre-existing `gemini` install (if any) is unaffected.

## Related

- Parent planning repo: [`context-bonsai-agents`](https://github.com/Vibecodelicious/context-bonsai-agents).
- Agent repo: [`gemini-cli` (Vibecodelicious fork of google-gemini/gemini-cli)](https://github.com/Vibecodelicious/gemini-cli).
- Per-agent spec: `docs/agent-specs/gemini-cli-context-bonsai-spec.md` (in the parent planning repo).

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md).

```sh
npm install
npm test
npm run typecheck
npm run build
```
