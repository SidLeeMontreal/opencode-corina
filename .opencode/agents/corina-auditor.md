---
description: Final quality auditor for Corina pipeline. Runs a binary 29-pattern checklist and banned-words scan. Returns structured AuditArtifact JSON with approved_for_delivery boolean. Never rewrites — approves or rejects.
mode: subagent
temperature: 0.1
permission:
  edit: deny
  bash: deny
  webfetch: deny
prompt: ../../prompts/tasks/auditor.md
---
