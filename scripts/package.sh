#!/usr/bin/env bash
#
# Build a Chrome Web Store-ready package for the Annoying Websites extension.
#
#   ./scripts/package.sh                 # validate + build
#   ./scripts/package.sh --check         # validate only
#   ./scripts/package.sh --bump patch    # bump version, then build
#   ./scripts/package.sh --bump minor
#   ./scripts/package.sh --bump major
#
# The Chrome Web Store expects a single .zip whose ROOT contains manifest.json.
# Everything else (README, scripts, .git) must stay out of the archive.
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OUT_DIR="$ROOT_DIR/dist"
CHECK_ONLY=0
BUMP=""

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
err()  { printf '%s✗%s %s\n' "$RED" "$RESET" "$1" >&2; }
info() { printf '%s→%s %s\n' "$BLUE" "$RESET" "$1"; }

usage() {
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# --- 0. Dependencies ---------------------------------------------------------
MISSING_DEPS=""
for dep in python3 zip unzip; do
  command -v "$dep" >/dev/null 2>&1 || MISSING_DEPS="$MISSING_DEPS $dep"
done
if [[ -n "$MISSING_DEPS" ]]; then
  err "Missing required tools:$MISSING_DEPS"
  err "On Fedora: sudo dnf install zip unzip python3"
  exit 1
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --bump)  BUMP="${2:-}"; shift 2 ;;
    --out)   OUT_DIR="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) err "Unknown option: $1"; usage 1 ;;
  esac
done

case "$BUMP" in
  ""|patch|minor|major) ;;
  *) err "--bump expects patch, minor or major"; exit 1 ;;
esac

# --- Files that must ship in the package -------------------------------------
RUNTIME_FILES=(
  manifest.json
  background.js
  shared.js
  content.js
  popup.html
  popup.js
  popup.css
  icons/icon16.png
  icons/icon32.png
  icons/icon48.png
  icons/icon128.png
)

# --- 1. Validate the manifest ------------------------------------------------
[[ -f manifest.json ]] || { err "manifest.json not found in $ROOT_DIR"; exit 1; }

if ! python3 -c 'import json,sys; json.load(open("manifest.json"))' 2>/dev/null; then
  err "manifest.json is not valid JSON"
  exit 1
fi
ok "manifest.json parses as valid JSON"

read_manifest() {
  python3 - "$1" <<'PY'
import json, sys
m = json.load(open("manifest.json"))
key = sys.argv[1]
value = m
for part in key.split("."):
    if isinstance(value, dict) and part in value:
        value = value[part]
    else:
        value = None
        break
if isinstance(value, (dict, list)):
    print(json.dumps(value))
elif value is None:
    print("")
else:
    print(value)
PY
}

MV=$(read_manifest manifest_version)
[[ "$MV" == "3" ]] || { err "manifest_version must be 3 (found '$MV')"; exit 1; }
ok "manifest_version is 3"

EXT_NAME=$(read_manifest name)
EXT_VERSION=$(read_manifest version)
EXT_DESC=$(read_manifest description)

[[ -n "$EXT_NAME" ]]  || { err "manifest.json is missing 'name'"; exit 1; }
[[ -n "$EXT_VERSION" ]] || { err "manifest.json is missing 'version'"; exit 1; }
[[ -n "$EXT_DESC" ]]   || { err "manifest.json is missing 'description'"; exit 1; }
[[ "$EXT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  err "version '$EXT_VERSION' must be plain MAJOR.MINOR.PATCH (no -beta suffixes for store uploads)"; exit 1; }
ok "name / version ($EXT_VERSION) / description present"

# --- 2. Optional version bump ------------------------------------------------
if [[ -n "$BUMP" ]]; then
  IFS='.' read -r MAJ MIN PAT <<< "$EXT_VERSION"
  case "$BUMP" in
    patch) PAT=$((PAT + 1)) ;;
    minor) MIN=$((MIN + 1)); PAT=0 ;;
    major) MAJ=$((MAJ + 1)); MIN=0; PAT=0 ;;
  esac
  NEW_VERSION="$MAJ.$MIN.$PAT"
  python3 - "$NEW_VERSION" <<'PY'
import json, re, sys
new = sys.argv[1]
raw = open("manifest.json").read()
raw = re.sub(r'("version"\s*:\s*")[^"]+(")', lambda m: m.group(1) + new + m.group(2), raw, count=1)
open("manifest.json", "w").write(raw)
PY
  EXT_VERSION="$NEW_VERSION"
  ok "version bumped to $EXT_VERSION"
fi

# --- 3. Every file the manifest references must exist ------------------------
MISSING=0
while IFS= read -r ref; do
  [[ -z "$ref" ]] && continue
  if [[ ! -f "$ROOT_DIR/$ref" ]]; then
    err "manifest references a missing file: $ref"
    MISSING=1
  fi
done < <(python3 - <<'PY'
import json
m = json.load(open("manifest.json"))
refs = []
for size, path in (m.get("icons") or {}).items():
    refs.append(path)
for size, path in (m.get("action", {}).get("default_icon") or {}).items():
    refs.append(path)
if m.get("action", {}).get("default_popup"):
    refs.append(m["action"]["default_popup"])
if m.get("background", {}).get("service_worker"):
    refs.append(m["background"]["service_worker"])
if m.get("background", {}).get("scripts"):
    refs += m["background"]["scripts"]
for cs in m.get("content_scripts", []):
    refs += cs.get("js", []) + cs.get("css", [])
for r in refs:
    print(r)
PY
)
[[ $MISSING -eq 0 ]] || exit 1
ok "all manifest-referenced files exist"

# --- 4. Runtime files present ------------------------------------------------
for f in "${RUNTIME_FILES[@]}"; do
  [[ -f "$ROOT_DIR/$f" ]] || { err "required runtime file missing: $f"; exit 1; }
done
ok "all runtime files present"

# --- 5. Policy pre-flight: no remote code ------------------------------------
POLICY_FAIL=0
scan() {  # scan <description> <grep-pattern> <files...>
  local label="$1" pattern="$2"; shift 2
  local hits
  hits=$(grep -nE "$pattern" "$@" 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    err "Possible policy violation ($label):"
    printf '    %s\n' "$hits" >&2
    POLICY_FAIL=1
  fi
}
JS_FILES=(background.js content.js popup.js shared.js)
scan "eval / dynamic code"      '\beval\s*\(|new\s+Function\s*\(' "${JS_FILES[@]}"
scan "remote script import"     'importScripts\s*\(\s*["'"'"']https?:' "${JS_FILES[@]}"
scan "remote code fetch"        'fetch\s*\(\s*["'"'"']https?://' "${JS_FILES[@]}"
scan "injection via innerHTML"  '\.innerHTML\s*=' "${JS_FILES[@]}"
scan "remote asset in HTML"     '<script[^>]+src=["'"'"']https?://|<link[^>]+href=["'"'"']https?://' popup.html
if [[ $POLICY_FAIL -eq 0 ]]; then
  ok "no remote code patterns found (Chrome Web Store MV3 requirement)"
else
  exit 1
fi

# --- 6. Already released? ----------------------------------------------------
if git -C "$ROOT_DIR" rev-parse -q --verify "refs/tags/v$EXT_VERSION" >/dev/null 2>&1; then
  warn "tag v$EXT_VERSION already exists - the store rejects a version it has seen before"
  warn "bump the version (./scripts/package.sh --bump patch) before uploading"
fi

# --- 7. Build ----------------------------------------------------------------
if [[ $CHECK_ONLY -eq 1 ]]; then
  ok "checks passed (no package built, --check)"
  exit 0
fi

STAGE_DIR=$(mktemp -d)
trap 'rm -rf "$STAGE_DIR"' EXIT

for f in "${RUNTIME_FILES[@]}"; do
  mkdir -p "$STAGE_DIR/$(dirname "$f")"
  cp "$ROOT_DIR/$f" "$STAGE_DIR/$f"
done

mkdir -p "$OUT_DIR"
ZIP_NAME="annoying-websites-${EXT_VERSION}.zip"
ZIP_PATH="$OUT_DIR/$ZIP_NAME"
rm -f "$ZIP_PATH"

# -r recurse, -X strip extra attributes, -9 max compression, -D no directory entries.
# Run from the staging dir so manifest.json lands at the ROOT of the archive.
( cd "$STAGE_DIR" && zip -r -X -9 -D "$ZIP_PATH" . -x '.*' >/dev/null )
ok "built $ZIP_PATH"

# --- 8. Verify the archive layout --------------------------------------------
BAD=$(unzip -Z1 "$ZIP_PATH" | grep -vE '^[^/]+$|^icons/[^/]+$|^icons/$' || true)
if [[ -n "$BAD" ]]; then
  err "archive contains unexpected paths (files must be at the root):"
  printf '    %s\n' "$BAD" >&2
  exit 1
fi
unzip -Z1 "$ZIP_PATH" | grep -qx 'manifest.json' || { err "manifest.json is not at the root of $ZIP_NAME"; exit 1; }
ok "manifest.json is at the archive root, no stray directories"

SIZE=$(du -h "$ZIP_PATH" | cut -f1)
info "archive: $ZIP_NAME  ($SIZE)"

cat <<EOF

$(printf '%s' "$GREEN")Packaged successfully.$(printf '%s' "$RESET")

  Extension : $EXT_NAME
  Version   : $EXT_VERSION
  Package   : $ZIP_PATH

Next steps:
  1. Upload $ZIP_NAME at
     https://chrome.google.com/webstore/devconsole
     (Developer account is a one-time \$5 fee.)
  2. Fill in the store listing, privacy disclosures, and screenshot.
  3. See PUBLISHING.md for the full walkthrough.
EOF
