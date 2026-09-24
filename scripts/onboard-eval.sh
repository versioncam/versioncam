#!/usr/bin/env bash
#
# The first run, headless: `/versioncam` in a copy of the example app that has
# no config, no clips and no skill — the Step 7 procedure of
# docs/wp6-versioncam.md, with nobody at the keyboard.
#
# It makes a throwaway worktree of this repository at HEAD, strips the example
# app back to an app, installs the skill the way a user would (`versioncam
# init`), and runs the skill once through `claude -p`, keeping the JSON. The
# worktree goes afterwards, whatever happened; the transcripts, the config the
# skill wrote and the clip are copied out first, because they are the result.
#
# It must run from a normal terminal: Claude Code refuses to launch inside
# another Claude Code session.
#
# Usage:
#   scripts/onboard-eval.sh
#
set -euo pipefail

if [[ -n "${CLAUDECODE:-}" ]]; then
  echo "Run this from a normal terminal — Claude Code cannot launch inside itself." >&2
  exit 1
fi

if ! claude auth status >/dev/null 2>&1; then
  echo "The CLI is not signed in. Run: claude auth login" >&2
  exit 1
fi

# The first run has to start the app from the config it writes. A dev server
# already on the port would be reused — and it would be some other checkout's.
if curl -sf -o /dev/null http://localhost:5174/; then
  echo "Something is serving :5174. Stop it first: this run has to start its own app." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/docs/evals/$(date +%Y-%m-%d)"
KEEP="$OUT/onboard"
mkdir -p "$OUT"

# E1's intent: the example app's first clip, which WP5 authored with a config
# already in place, and which here has to be preceded by writing one.
INTENT="Create a shipment for a new recipient and show it appearing in the list."

WT="$(mktemp -d "${TMPDIR:-/tmp}/versioncam-onboard.XXXXXX")/repo"
cleanup() {
  local app="$WT/examples/demo-app"
  if [[ -d "$app" ]]; then
    rm -rf "$KEEP" && mkdir -p "$KEEP"
    [[ -f "$app/versioncam.config.ts" ]] && cp "$app/versioncam.config.ts" "$KEEP/"
    [[ -d "$app/demos" ]] && cp -R "$app/demos" "$KEEP/"
    [[ -d "$app/.versioncam/author" ]] && cp -R "$app/.versioncam/author" "$KEEP/"
    [[ -f "$app/.versioncam/webserver.log" ]] && cp "$app/.versioncam/webserver.log" "$KEEP/"
    (cd "$WT" && git status --short) > "$KEEP/git-status.txt" 2>&1 || true
  fi
  git -C "$ROOT" worktree remove --force "$WT" 2>/dev/null || true
}
trap cleanup EXIT

echo "── worktree $WT"
git -C "$ROOT" worktree add --detach "$WT" HEAD >/dev/null
( cd "$WT" && npm ci --silent && npm run build --silent >/dev/null )

APP="$WT/examples/demo-app"
( cd "$APP" && rm -rf versioncam.config.ts demos .claude && npx versioncam init )

echo "── onboard"
echo "   $INTENT"
started=$(date +%s)

# `/versioncam` is the skill `init` just put in `.claude/`: a project skill
# wins over a plugin's of the same name, which is namespaced instead. The
# plugin is loaded as well for its reviewer, which then registers as an agent
# whichever way Claude Code looks for project agents — so the verdict can come
# from the restricted rung. `AskUserQuestion` is withheld because nobody is
# there to answer it; the first run's brief says what to do when it cannot ask.
( cd "$APP" && claude -p "/versioncam \"$INTENT\"" \
    --plugin-dir "$WT/packages/recorder/plugin" \
    --disallowedTools AskUserQuestion \
    --output-format json \
    --permission-mode bypassPermissions \
    > "$OUT/onboard.json" ) || echo "   (exited non-zero — the JSON still has the reason)"

elapsed=$(( $(date +%s) - started ))
python3 - "$OUT/onboard.json" "$elapsed" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception as e:
    print(f"   could not read the result: {e}"); raise SystemExit
c = d.get("total_cost_usd")
print(f"   list-price equiv. ${c:.4f}" if isinstance(c, (int, float)) else f"   cost {c}")
print(f"   turns {d.get('num_turns', '?')}   wall {int(sys.argv[2])//60}m{int(sys.argv[2])%60}s")
print(f"   result {str(d.get('result', ''))[:300]}")
PY

echo
echo "JSON in $OUT/onboard.json; the config, clips, transcripts and git status the run left in $KEEP."
echo "Nothing was committed anywhere: the worktree is removed on exit."
