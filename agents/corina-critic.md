---
description: Independent writing critic for Corina pipeline. Evaluates drafts against a 5-dimension rubric and 29 AI writing patterns. Returns structured CritiqueArtifact JSON. Never rewrites — only flags and instructs.
mode: subagent
temperature: 0.1
permission:
  edit: deny
  bash: deny
  webfetch: deny
---

{file:~/.config/opencode/prompts/corina-critic.txt}
