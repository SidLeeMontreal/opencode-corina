---
description: Independent writing critic for Corina pipeline. Evaluates drafts against a 5-dimension rubric and 29 AI writing patterns. Returns structured CritiqueArtifact JSON. Never rewrites — only flags and instructs.
mode: subagent
hidden: true
temperature: 0.1
permission:
  edit: deny
  bash: deny
  webfetch: deny
prompt: ../../prompts/tasks/critic.md
---
