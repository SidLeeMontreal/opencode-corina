# opencode-corina

Corina is a writing plugin for OpenCode that wraps a gated five-step editorial workflow around a strategic writing agent. The repo root is canonical: it owns Corina capability logic, prompts, schemas, tools, tests, and evals. This repo also includes a hosted deployment wrapper under `deploy/openwork-server/` so the same root runtime can be served through OpenWork.

## Repo modes

This repo operates in two modes:

1. **plugin/package mode** at repo root
2. **hosted deployment mode** under `deploy/openwork-server/`

Separation of concerns:

- **Repo root**: Corina behavior, editorial pipeline, prompts, schemas, evals, tests, and local `.opencode/` assets
- **`deploy/openwork-server/`**: container, proxy, OpenWork wiring, and deployment configuration for hosting the root repo

Architecture references:

- `docs/architecture-plugin.md`
- `docs/architecture-deployment.md`

## What Corina is

Corina is designed for higher-signal writing work where a single draft is not enough. Instead of generating text in one pass, the plugin moves through a controlled sequence:

1. brief intake
2. outline generation
3. draft generation
4. critique and revision
5. final audit

That structure makes it easier to add guardrails, catch weak output earlier, and maintain a clear audit trail.

## Plugin/package mode

This remains the canonical development workflow.

### Install and build

```bash
cd ~/dev/personal/opencode-corina
npm install
npm run build
npm run install-corina
```

Useful follow-up checks:

```bash
npm run test:unit
npm run test:integration
npm run eval:tier1
```

To use the built package in OpenCode, point your local OpenCode plugin configuration at this repository after compilation.

### As an npm package

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-corina"]
}
```

Then install:

```bash
npm install -g opencode-corina
```

### As a local project plugin

Clone this repo and run OpenCode from the repo root. OpenCode will automatically load `.opencode/plugins/corina.ts`.

Dependencies for local use are declared in `.opencode/package.json` and installed by OpenCode via Bun at startup. Run `npm install` in this repo first: the `preinstall` script clones `opencode-model-resolver`, `opencode-text-tools`, and `opencode-eval-harness` into `deps/`, builds them, and wires them via `file:deps/…`. Git is required. Set `SKIP_OPENCODE_DEPS=1` to skip that step if you manage `deps/` yourself.

## Hosted deployment mode

The hosted wrapper lives entirely under `deploy/openwork-server/`.

Root scripts for hosted operations:

```bash
npm run deploy:build
npm run deploy:run
npm run deploy:dev
npm run deploy:compose
```

Typical setup:

```bash
cp deploy/openwork-server/.env.example deploy/openwork-server/.env
npm run deploy:build
npm run deploy:compose
```

For a local hosted dev loop against a bind-mounted checkout:

```bash
npm run deploy:dev
```

Use these files as the hosted source of truth:

- `deploy/openwork-server/README.md`
- `deploy/openwork-server/Dockerfile`
- `deploy/openwork-server/entrypoint.sh`
- `deploy/openwork-server/docker-compose.yml`
- `deploy/openwork-server/opencode.jsonc`
- `.github/workflows/build-and-deploy.yml`

### Tool usage

The plugin registers custom tools including `write`.

Example call shape:

```ts
await ctx.callTool("write", {
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

## Testing

### Offline-only test commands

These commands do not require a running OpenCode server:

```bash
npm run test
npm run test:unit
npm run test:regression
npm run eval:tier1
```

### Live OpenCode-dependent commands

These commands are **not** self-contained from this repo alone. They require a running local OpenCode server plus whatever non-repo OpenCode/provider configuration that server needs on your machine.

```bash
npm run test:integration
npm run test:all
npm run eval:tier2
npm run eval:baseline
```

Why:
- every file under `tests/integration/` creates an SDK client with `process.env.OPENCODE_URL ?? "http://127.0.0.1:4098"`
- `src/tool-runtime.ts` uses the same default, with `OPENCODE_BASE_URL` accepted as an alias
- `scripts/run-eval.mjs` uses the same live endpoint for Tier 2 (`--mode judge`) and compare/baseline runs

### Local live integration-test flow

Minimum prerequisites:
- `npm install`
- local OpenCode CLI/runtime installed and available as `opencode`
- usable OpenCode/provider configuration outside this repo if your local OpenCode setup requires it

Install Corina's local agents from the repo root:

```bash
npm run install-corina
```

Start the local OpenCode server from the repo root:

```bash
opencode serve --hostname 127.0.0.1 --port 4098 --print-logs
```

In another shell, verify the server:

```bash
curl -fsS http://127.0.0.1:4098/global/health
```

Then run the live integration suite, the full suite, or a specific live test file:

```bash
OPENCODE_URL=http://127.0.0.1:4098 npm run test:integration
OPENCODE_URL=http://127.0.0.1:4098 npm run test:all
OPENCODE_URL=http://127.0.0.1:4098 npx vitest run tests/integration/pipeline.e2e.test.ts
```

Environment and defaults:
- default live endpoint: `http://127.0.0.1:4098`
- primary env var: `OPENCODE_URL`
- runtime alias used by `src/tool-runtime.ts`: `OPENCODE_BASE_URL`
- expected local port in repo docs/tests: `4098`

Important caveat:
- `npm run test:all` includes the live integration tests, so it will fail if no OpenCode server is running at the configured URL
- under the validated local setup (`OPENCODE_URL=http://127.0.0.1:4098` with a healthy local OpenCode server), `test:unit`, `test:regression`, `test:integration`, and `test:all` all pass
- live-path results still depend on the external OpenCode/provider behavior behind that server

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


## Evaluation workflow

Corina uses the `opencode-eval-harness` package (cloned into `deps/` by `npm install`) for structured eval runs.

### Corpus and suites

- Corpus: `evals/corpus/corina-corpus.json`
- Suites: `evals/suites/`
- Runner module: `evals/runners/corina-runner.mjs`
- Baselines: `evals/baselines/`
- Reports: `evals/reports/`

### Commands

```bash
npm run eval:tier1     # offline deterministic Tier 1 run
npm run eval:tier2     # live Tier 2 judge run (requires OpenCode server)
npm run eval:baseline  # live Tier 2 run and save baseline
```

### Tier behavior

- **Tier 1** uses fixture-backed candidate outputs and programmatic checks only.
- **Tier 2** runs live Corina capabilities and scores them with a judge agent.
- `scripts/run-eval.mjs` is now a thin wrapper around `opencode-eval-harness`.

### Baselines and reports

- Baselines default to `evals/baselines/{suite-name}.json`
- Saved reports land in `evals/reports/`
- PR CI runs Tier 1 only via `.github/workflows/eval-tier1.yml`

## Editing prompts

All Corina prompts now live in `prompts/` and are versioned with the package.

### Bundled prompts
- Base prompt: `prompts/base/`
- Task prompts: `prompts/tasks/`
- Voice prompts: `prompts/voices/`

Edit those files directly, then restart your OpenCode server from the repo root so project-local agents resolve the updated prompt paths correctly.

### Local overrides
To override a prompt without committing it, create a matching file under `.corina-local/prompts/`.

Example:
- `.corina-local/prompts/tasks/critic.md` overrides `prompts/tasks/critic.md`
- `.corina-local/prompts/voices/journalist.md` overrides `prompts/voices/journalist.md`

TypeScript prompt loaders check `.corina-local/prompts/` first, then fall back to the bundled prompt under `prompts/`.

### Installing project agents
Run:

```bash
npm run install-corina
```

This generates `.opencode/agents/` with prompt paths that resolve relative to the repo root.

### When to bump the version
See `CHANGELOG-prompts.md`. In short:
- patch: no intended behavior change
- minor: prompt tuning or new prompt assets
- major: persona, rubric, or output-contract changes

