# Prompt Inventory — COR-200

Generated: 2026-04-10

## Prompt files under `~/.config/opencode/prompts/`

### Base/task prompts
- `~/.config/opencode/prompts/corina-persona.txt`
- `~/.config/opencode/prompts/corina-critic.txt`
- `~/.config/opencode/prompts/corina-auditor.txt`
- `~/.config/opencode/prompts/corina-tone-writer.txt`
- `~/.config/opencode/prompts/corina-tone-validator.txt`
- `~/.config/opencode/prompts/corina-detector.txt`
- `~/.config/opencode/prompts/corina-audience-critic.txt`
- `~/.config/opencode/prompts/corina-rubric-critic.txt`

### Voice prompts
- `~/.config/opencode/prompts/voices/accessibility.txt`
- `~/.config/opencode/prompts/voices/brand.txt`
- `~/.config/opencode/prompts/voices/email.txt`
- `~/.config/opencode/prompts/voices/executive.txt`
- `~/.config/opencode/prompts/voices/journalist.txt`
- `~/.config/opencode/prompts/voices/personal.txt`
- `~/.config/opencode/prompts/voices/persuasive.txt`
- `~/.config/opencode/prompts/voices/seo.txt`
- `~/.config/opencode/prompts/voices/social.txt`
- `~/.config/opencode/prompts/voices/technical.txt`
- `~/.config/opencode/prompts/voices/ux.txt`

## Agent `{file:...}` references found in repo
- `agents/corina.md` → `{file:~/.config/opencode/prompts/corina-persona.txt}`
- `agents/corina-critic.md` → `{file:~/.config/opencode/prompts/corina-critic.txt}`
- `agents/corina-auditor.md` → `{file:~/.config/opencode/prompts/corina-auditor.txt}`
- `agents/corina-detector.md` → `{file:~/.config/opencode/prompts/corina-detector.txt}`

## Programmatic prompt loading found in TypeScript source
- `src/steps.ts`
  - `const PROMPTS_DIR = join(homedir(), ".config", "opencode", "prompts")`
  - `readFileSync(join(PROMPTS_DIR, filename), "utf8")`
  - Used for pipeline prompt files:
    - `corina-persona.txt`
    - `corina-critic.txt`
    - `corina-auditor.txt`
- `src/tone-pipeline.ts`
  - `const PROMPTS_DIR = join(homedir(), ".config", "opencode", "prompts")`
  - `const VOICES_DIR = join(PROMPTS_DIR, "voices")`
  - `readFileSync(...)` against prompt files and voice files
  - Direct/static prompt file references:
    - `corina-tone-writer.txt`
    - `corina-tone-validator.txt`
    - `voices/*.txt` through directory scanning / path resolution
    - personal tone description fallback from `~/.config/opencode/corina/profiles/` (not part of prompt migration)
- `src/detect-layer2.ts`
  - `const PROMPTS_DIR = join(homedir(), ".config", "opencode", "prompts")`
  - Direct reference: `corina-detector.txt`
- `src/critique.ts`
  - `const PROMPTS_DIR = join(homedir(), ".config", "opencode", "prompts")`
  - Direct/static prompt file references:
    - `corina-audience-critic.txt`
    - `corina-rubric-critic.txt`

## Unreferenced prompt files relative to current repo state
These exist under `~/.config/opencode/prompts/` but are not referenced by current agent markdown files in this repo:
- `corina-tone-writer.txt`
- `corina-tone-validator.txt`
- `corina-audience-critic.txt`
- `corina-rubric-critic.txt`
- all 11 files under `voices/`

They are still referenced by TypeScript runtime code, so they are active prompt assets, not deletion candidates.

## Notes
- Current repo contains 4 committed agent markdown files in `agents/`:
  - `corina.md`
  - `corina-critic.md`
  - `corina-auditor.md`
  - `corina-detector.md`
- Ticket/spec language mentions more agents, but those additional agent files are not present in the current repo checkout.
