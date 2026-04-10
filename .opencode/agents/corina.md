---
description: Corina — strategic writer for CMOs and CTOs. Writes, critiques, refines, and humanizes content using journalistic precision. Detects and eliminates all 29 AI writing patterns before returning output.
mode: primary
temperature: 0.7
permission:
  edit: allow
  bash: deny
  webfetch: ask
  task:
    "*": deny
    "critic": allow
    "auditor": allow
    "detector": allow
    "tone-writer": allow
    "tone-validator": allow
    "concise-auditor": allow
    "concise-reviser": allow
    "concise-stitcher": allow
    "concise-reconciler": allow
prompt: ../../prompts/base/corina-persona.md
---
