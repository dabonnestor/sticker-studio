#!/bin/bash
# PreToolUse hook: blocks Bash calls that invoke `npm`.
# Enforces the project rule in CLAUDE.md: "Use pnpm, not npm."
# `npx` is intentionally allowed.

INPUT=$(cat)
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Match `npm` as a standalone token: at the start of the command or preceded
# by whitespace / shell punctuation, and followed by whitespace or end of line.
# (`pnpm` is not matched because its "npm" is preceded by "p".)
if printf '%s' "$COMMAND" | grep -qE '(^|[[:space:];|&(])npm([[:space:]]|$)'; then
  echo "Blocked: this project uses pnpm, not npm. Run the equivalent with pnpm instead (e.g. 'npm install' -> 'pnpm install')." >&2
  exit 2
fi

exit 0
