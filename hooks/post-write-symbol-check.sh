#!/bin/bash
#
# PostToolUse hook for Write/Edit - checks for hallucinated symbols
# Calls symbol-check.mjs to validate:
#   - Import paths pointing to files that don't exist
#   - Imported symbols not found in project registry
#   - Standalone function calls to unknown symbols
#   - API routes not found in project index
#

# Read JSON input from stdin
INPUT=$(cat)

# Extract file_path from tool_input
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Only check code files
case "$FILE_PATH" in
  *.js|*.mjs|*.cjs|*.jsx|*.ts|*.tsx|*.py|*.go|*.rs) ;;
  *) exit 0 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

# Find project root (look for .wisdom dir or package.json)
find_project_root() {
  local dir
  dir="$(dirname "$FILE_PATH")"
  while [ "$dir" != "/" ]; do
    if [ -d "$dir/.wisdom" ] || [ -f "$dir/package.json" ]; then
      echo "$dir"
      return
    fi
    dir="$(dirname "$dir")"
  done
  echo ""
}

PROJECT_ROOT="$(find_project_root)"
if [ -n "$PROJECT_ROOT" ]; then
  SYMBOLS_FILE="$PROJECT_ROOT/.wisdom/symbols.json"
  if [ -f "$SYMBOLS_FILE" ]; then
    if [ "$TOOL_NAME" = "Edit" ]; then
      DIFF_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.new_string // empty')
      SYMBOL_OUTPUT=$(echo "$DIFF_CONTENT" | node "$SCRIPT_DIR/symbol-check.mjs" "$FILE_PATH" "$SYMBOLS_FILE" --diff-only 2>&1)
    else
      SYMBOL_OUTPUT=$(node "$SCRIPT_DIR/symbol-check.mjs" "$FILE_PATH" "$SYMBOLS_FILE" 2>&1)
    fi
    SYMBOL_EXIT=$?

    if [ $SYMBOL_EXIT -eq 2 ] && [ -n "$SYMBOL_OUTPUT" ]; then
      echo -e "$SYMBOL_OUTPUT" >&2
      exit 2
    fi
  fi
fi
