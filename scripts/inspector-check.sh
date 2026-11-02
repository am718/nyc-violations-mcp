#!/usr/bin/env bash
# Calls all 5 tools through the MCP Inspector CLI against LIVE NYC Open Data and saves raw output
# to docs/evidence/. Needs network. Uses an in-memory cache and no app token.
set -uo pipefail
cd "$(dirname "$0")/.."
npm run --silent build
export NYC_VIOLATIONS_CACHE_DB=:memory:
unset SOCRATA_APP_TOKEN
mkdir -p docs/evidence
insp() { npx --yes @modelcontextprotocol/inspector --cli node dist/src/index.js "$@"; }
run() { local out=$1; shift; insp "$@" 2>/dev/null > "docs/evidence/$out.json"; echo "$out exit=$? bytes=$(wc -c < "docs/evidence/$out.json")"; }
run inspector-tools-list --method tools/list
run inspector-resolve_property --method tools/call --tool-name resolve_property --tool-arg 'address=350 5th Ave, Manhattan'
run inspector-get_dob_violations --method tools/call --tool-name get_dob_violations --tool-arg bin=1015862 --tool-arg status=open --tool-arg limit=3
run inspector-get_ecb_violations --method tools/call --tool-name get_ecb_violations --tool-arg bin=1015862 --tool-arg limit=3
run inspector-get_hpd_violations --method tools/call --tool-name get_hpd_violations --tool-arg bbl=2046540021 --tool-arg status=open --tool-arg limit=3
run inspector-building_compliance_summary --method tools/call --tool-name building_compliance_summary --tool-arg 'address=350 5th Ave, Manhattan'
run inspector-error-bad-bin --method tools/call --tool-name get_dob_violations --tool-arg "bin=1015862' OR '1'='1"
run inspector-error-placeholder-bin --method tools/call --tool-name get_hpd_violations --tool-arg bin=1000000
run inspector-status-any-case --method tools/call --tool-name get_dob_violations --tool-arg bin=1015862 --tool-arg status=OPEN --tool-arg limit=2
