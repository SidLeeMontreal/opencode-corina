# opencode-corina

Corina is a writing plugin for OpenCode that wraps a gated five-step editorial workflow around a strategic writing agent. The package in this repository is the orchestrator: it validates structured artifacts, coordinates each stage of the pipeline, and records audit events.

## What Corina is

Corina is designed for higher-signal writing work where a single draft is not enough. Instead of generating text in one pass, the plugin moves through a controlled sequence:

1. brief intake
2. outline generation
3. draft generation
4. critique and revision
5. final audit

That structure makes it easier to add guardrails, catch weak output earlier, and maintain a clear audit trail.

## Install

```bash
cd ~/dev/personal/opencode-corina
npm install
npm run build
```

To use the built package in OpenCode, point your local OpenCode plugin configuration at this repository after compilation.

## Usage

The plugin registers a custom tool named `corina_write`.

Example call shape:

```ts
await ctx.callTool("corina_write", {
  brief: "Write a sharp article for CTOs on why AI governance fails when it is owned only by legal."
});
```

At the moment, the internal step runners are scaffolded with stub implementations and clear TODO markers showing where OpenCode SDK model calls should be added.

## The 5-step pipeline

### 1. Brief intake
Transforms raw user input into a `BriefArtifact`. If required information is missing, the pipeline returns a clarification request instead of proceeding.

### 2. Outline
Builds an `OutlineArtifact` with thesis, structure, risks, and editorial intent. The pipeline retries once if outline validation fails.

### 3. Draft
Builds a `DraftArtifact` and runs a banned-words pre-scan before moving forward.

### 4. Critique loop
Runs up to two critique passes using a `CritiqueArtifact`. If the critique fails, the draft is revised and validated again.

### 5. Final audit
Runs an `AuditArtifact` check and returns either final content or the content plus a warning block.

## Architecture overview

```text
src/
├── index.ts        # plugin entry point and tool registration
├── pipeline.ts     # state machine for the 5-step flow
├── steps.ts        # step-level runners and stubbed model calls
├── validators.ts   # AJV validators for all artifacts
├── audit-log.ts    # JSONL audit writer
└── types.ts        # shared TypeScript interfaces
```

Supporting assets:

- `schemas/` contains the JSON schemas used for validation.
- `agents/` contains the installed OpenCode agent markdown definitions copied into the package.

## Contributing

Contributions are welcome, especially in these areas:

- replacing the scaffold step stubs with real OpenCode SDK calls
- tightening the artifact contracts as the writing workflow matures
- improving audit metadata and operational observability
- extending critique and banned-language detection

Suggested workflow:

1. create a branch
2. make changes
3. run `npm run build`
4. verify the generated files in `dist/`
5. open a pull request

## Notes

- This package is scaffolded for local development and has **not** been published to npm.
- `@opencode-ai/plugin` types are currently represented by local TypeScript stubs so the package can compile today.
