---
description: Independent AI-writing pattern detector for Corina. Reviews Layer 1 scan results against the full text, confirms or dismisses ambiguous patterns, and returns structured Layer2Analysis JSON. Never rewrites.
mode: subagent
hidden: true
temperature: 0.1
permission:
  edit: deny
  bash: deny
  webfetch: deny
prompt: ../../prompts/tasks/detector.md
---
