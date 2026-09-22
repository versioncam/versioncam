#!/usr/bin/env bash
#
# Run the authoring loop headlessly, once per intent, and keep the JSON.
#
# This is the only way to get a cost per clip: `total_cost_usd` and the token
# counts live in `claude -p --output-format json` and nowhere else. It is also
# the only run in which Claude Code discovers the skill and registers the agent
# types itself, rather than an orchestrating session standing in for them.
#
# It must run from a normal terminal. Claude Code refuses to launch inside
# another Claude Code session, and the check below is that refusal made early
# and legible rather than forty seconds into the first intent.
#
# Usage:
#   scripts/author-eval.sh                 # all three example intents
#   scripts/author-eval.sh e1              # just one, to see it work first
#
set -euo pipefail

if [[ -n "${CLAUDECODE:-}" ]]; then
  cat >&2 <<'MSG'
This is running inside a Claude Code session, which cannot launch another one.
Open a normal terminal — Terminal.app, iTerm, a plain shell — and run it there.
MSG
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/examples/demo-app"
PLUGIN="$ROOT/packages/recorder/plugin"
OUT="$ROOT/docs/evals/$(date +%Y-%m-%d)"
mkdir -p "$OUT"

# A 401 costs three minutes per intent before it gives up, because the CLI
# retries an error that will never succeed. Nine minutes to learn that a token
# expired is nine minutes too many.
if ! claude auth status >/dev/null 2>&1; then
  echo "The CLI is not signed in — `claude auth status` says so." >&2
  echo "Run: claude auth login    (or: claude setup-token, for a long-lived one)" >&2
  exit 1
fi

if ! curl -sf -o /dev/null http://localhost:5174/; then
  echo "The example app is not answering on :5174. In another terminal:" >&2
  echo "  cd $APP && npm run dev" >&2
  exit 1
fi

declare -a IDS=() INTENTS=()
add() { IDS+=("$1"); INTENTS+=("$2"); }
add e1 "Create a shipment for a new recipient and show it appearing in the list."
add e2 "Find a shipment by filtering the list, and show how many matched."
add e3 "Cancel a shipment, confirming in the dialog, and show the list after."

WANTED="${1:-all}"

for i in "${!IDS[@]}"; do
  id="${IDS[$i]}"; intent="${INTENTS[$i]}"
  [[ "$WANTED" != "all" && "$WANTED" != "$id" ]] && continue

  echo "── $id ──────────────────────────────────────────────"
  echo "   $intent"
  started=$(date +%s)

  # `--permission-mode bypassPermissions` because the loop spawns subagents that
  # run `npx demos …` and write a clip file, and a prompt nobody is there to
  # answer stalls the run. Everything it touches is inside this repository.
  ( cd "$APP" && claude -p "/demos-author \"$intent\"" \
      --plugin-dir "$PLUGIN" \
      --output-format json \
      --permission-mode bypassPermissions \
      > "$OUT/$id.json" ) || echo "   (exited non-zero — the JSON still has the reason)"

  elapsed=$(( $(date +%s) - started ))
  python3 - "$OUT/$id.json" "$elapsed" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print(f"   could not read the result: {e}"); raise SystemExit
cost = d.get("total_cost_usd")
usage = d.get("usage") or {}
print(f"   cost  ${cost:.4f}" if isinstance(cost, (int, float)) else f"   cost  {cost}")
print(f"   turns {d.get('num_turns', '?')}   wall {sys.argv[2]}s")
if usage:
    print(f"   tokens in {usage.get('input_tokens', '?')} out {usage.get('output_tokens', '?')}")
print(f"   result {str(d.get('result', ''))[:200]}")
PY
  echo
done

echo "JSON in $OUT — that is what the plan's Part V table needs."
