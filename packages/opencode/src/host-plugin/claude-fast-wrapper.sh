#!/usr/bin/env bash
set -euo pipefail

claude_cli="${HONK_CLAUDE_CLI_PATH:-${CLAUDE_CLI_PATH:-claude}}"
args=("$@")

for ((index = 0; index < ${#args[@]} - 1; index++)); do
  if [[ "${args[index]}" != "--model" ]]; then
    continue
  fi

  if [[ "${args[index + 1]}" == "claude-opus-5-fast" ]]; then
    args[index + 1]="claude-opus-5"
    args+=("--settings" '{"fastMode":true}')
    break
  fi

  if [[ "${args[index + 1]}" == "claude-opus-5" ]]; then
    args+=("--settings" '{"fastMode":false}')
    break
  fi
done

# Replace Claude Code's built-in prompt with Pi's AgentHarness default. OpenCode's
# agent system remains in the plugin-provided --append-system-prompt-file.
if [[ " ${args[*]} " == *" --model "* ]]; then
  args+=("--system-prompt" "You are a helpful assistant.")
fi

exec "$claude_cli" "${args[@]}"
