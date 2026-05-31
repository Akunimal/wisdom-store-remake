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

json_value() {
  local path="$1"
  printf '%s' "$INPUT" | JSON_PATH="$path" node -e '
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  try {
    let value = JSON.parse(input || "{}");
    for (const segment of (process.env.JSON_PATH || "").split(".")) {
      if (!segment) continue;
      value = value?.[segment];
    }
    if (value !== undefined && value !== null) {
      process.stdout.write(String(value));
    }
  } catch {}
});
'
}

# Extract file_path from tool_input
FILE_PATH=$(json_value 'tool_input.file_path')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

FILE_PATH="${FILE_PATH//\\//}"

# Only check code files
case "$FILE_PATH" in
  *.js|*.mjs|*.cjs|*.jsx|*.ts|*.tsx|*.py|*.go|*.rs) ;;
  *) exit 0 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOL_NAME=$(json_value 'tool_name')

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
      DIFF_CONTENT=$(json_value 'tool_input.new_string')
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
