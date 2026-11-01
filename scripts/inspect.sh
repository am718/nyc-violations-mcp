#!/usr/bin/env bash
# Run the server under the MCP Inspector.
#   scripts/inspect.sh            -> opens the Inspector web UI
#   scripts/inspect.sh --cli ...  -> Inspector CLI mode, e.g.
#     scripts/inspect.sh --cli --method tools/list
#     scripts/inspect.sh --cli --method tools/call --tool-name get_dob_violations --tool-arg bin=1015862 --tool-arg limit=3
set -euo pipefail
cd "$(dirname "$0")/.."
npm run --silent build
exec npx --yes @modelcontextprotocol/inspector "$@" node dist/src/index.js
