# Prompt Changelog

## v1.0.0 — 2026-04-10

### Migrated from external to repo
- Moved all Corina prompt assets from `~/.config/opencode/prompts/` into `prompts/`
- Renamed prompt files from `.txt` to `.md`
- Added YAML frontmatter to each prompt file
- Replaced absolute prompt references with repo-relative paths
- Added local override support via `.corina-local/prompts/`

### Prompt files included

#### Base
- `prompts/base/corina-persona.md` — primary Corina system prompt for the main writing agent

#### Tasks
- `prompts/tasks/critic.md` — structured critique prompt for the quality critic
- `prompts/tasks/auditor.md` — final audit prompt for approval/rejection checks
- `prompts/tasks/tone-writer.md` — tone rewrite prompt used by the tone pipeline
- `prompts/tasks/tone-validator.md` — validation prompt for tone rewrites
- `prompts/tasks/detector.md` — layer 2 AI-pattern analysis prompt
- `prompts/tasks/audience-critic.md` — audience-fit critique prompt
- `prompts/tasks/rubric-critic.md` — rubric-based scoring prompt

#### Voices
- `prompts/voices/accessibility.md` — accessibility-focused rewrite rules
- `prompts/voices/brand.md` — brand-voice rewrite rules
- `prompts/voices/commercial-email.md` — commercial email rewrite rules (voice id `email`)
- `prompts/voices/executive.md` — executive-summary rewrite rules
- `prompts/voices/journalist.md` — journalist-style rewrite rules
- `prompts/voices/personal.md` — personal voice rewrite rules
- `prompts/voices/persuasive.md` — persuasive rewrite rules
- `prompts/voices/seo.md` — SEO rewrite rules
- `prompts/voices/social.md` — social-post rewrite rules
- `prompts/voices/technical.md` — technical rewrite rules
- `prompts/voices/ux.md` — UX writing rewrite rules

## Versioning policy
- **patch**: wording cleanup, typo fixes, or metadata updates with no intended behavior change
- **minor**: new prompt files or non-breaking prompt tuning
- **major**: changed persona/voice contract, removed assets, or breaking rubric/output behavior changes
