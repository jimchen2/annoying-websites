#!/usr/bin/env bash
#
# Upload and publish the Annoying Websites extension to the Chrome Web Store
# using the Chrome Web Store API v2.
#
#   API v1.1 (www.googleapis.com/chromewebstore/v1.1/...) was retired on
#   2026-10-15. Everything here uses the v2 endpoints.
#
# Required environment variables:
#   CWS_CLIENT_ID       OAuth 2.0 client ID      (Google Cloud console)
#   CWS_CLIENT_SECRET   OAuth 2.0 client secret
#   CWS_REFRESH_TOKEN   OAuth 2.0 refresh token  (scope: .../auth/chromewebstore)
#   CWS_PUBLISHER_ID    Publisher ID              (Developer Dashboard > Account)
#   CWS_ITEM_ID         Extension ID              (Developer Dashboard > item URL)
#
# Optional:
#   CWS_PUBLISH_TYPE    DEFAULT_PUBLISH (default) or STAGED_PUBLISH
#
# Usage:
#   ./scripts/publish.sh                       # upload + publish
#   ./scripts/publish.sh --no-publish          # upload as draft only
#   ./scripts/publish.sh --zip dist/foo.zip    # publish a specific package
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
ok()   { printf '%s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
err()  { printf '%s✗%s %s\n' "$RED" "$RESET" "$1" >&2; }
info() { printf '%s→%s %s\n' "$BLUE" "$RESET" "$1"; }

DO_PUBLISH=1
ZIP_PATH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-publish) DO_PUBLISH=0; shift ;;
    --zip) ZIP_PATH="$2"; shift 2 ;;
    -h|--help) sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) err "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Config ------------------------------------------------------------------
MISSING=0
for var in CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN CWS_PUBLISHER_ID CWS_ITEM_ID; do
  if [[ -z "${!var:-}" ]]; then
    err "Environment variable $var is not set"
    MISSING=1
  fi
done
[[ $MISSING -eq 0 ]] || { err "See the header of this script for the required variables."; exit 1; }

if [[ -z "$ZIP_PATH" ]]; then
  ZIP_PATH=$(ls -t "$ROOT_DIR"/dist/annoying-websites-*.zip 2>/dev/null | head -1 || true)
  [[ -n "$ZIP_PATH" ]] || { err "No package found in dist/. Run ./scripts/package.sh first."; exit 1; }
fi
[[ -f "$ZIP_PATH" ]] || { err "Package not found: $ZIP_PATH"; exit 1; }

PUBLISH_TYPE="${CWS_PUBLISH_TYPE:-DEFAULT_PUBLISH}"
ITEM="publishers/${CWS_PUBLISHER_ID}/items/${CWS_ITEM_ID}"
BASE="https://chromewebstore.googleapis.com"

info "package  : $(basename "$ZIP_PATH")"
info "item     : $ITEM"
info "type     : $PUBLISH_TYPE"

# --- 1. Access token ---------------------------------------------------------
TOKEN=$(curl -sS -X POST https://oauth2.googleapis.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=${CWS_CLIENT_ID}" \
  -d "client_secret=${CWS_CLIENT_SECRET}" \
  -d "refresh_token=${CWS_REFRESH_TOKEN}" \
  -d "grant_type=refresh_token" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("access_token",""))')

[[ -n "$TOKEN" ]] || { err "Could not obtain an access token. Check the OAuth client and refresh token."; exit 1; }
ok "obtained access token"

# --- 2. Current store status -------------------------------------------------
STATUS=$(curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/v2/$ITEM:fetchStatus")
echo "$STATUS" | python3 -c '
import json,sys
d = json.load(sys.stdin)
print("  current store state:")
for k in ("uploadState","crxVersion","publishedVersionNumber","status"):
    if k in d:
        print(f"    {k}: {d[k]}")
' 2>/dev/null || true

# --- 3. Upload ---------------------------------------------------------------
info "uploading package..."
UPLOAD=$(curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -T "$ZIP_PATH" \
  "${BASE}/upload/v2/${ITEM}:upload")

UPLOAD_STATE=$(echo "$UPLOAD" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("uploadState",""))' 2>/dev/null || echo "")
if [[ "$UPLOAD_STATE" != "UPLOAD_IN_PROGRESS" && "$UPLOAD_STATE" != "SUCCEEDED" ]]; then
  err "Upload was rejected:"
  echo "$UPLOAD" | python3 -m json.tool 2>/dev/null || echo "$UPLOAD"
  err "Most common causes: the version number was not increased, or the zip layout is wrong."
  exit 1
fi

# Poll until the upload finishes.
for _ in $(seq 1 30); do
  [[ "$UPLOAD_STATE" == "SUCCEEDED" ]] && break
  sleep 2
  UPLOAD_STATE=$(curl -sS -H "Authorization: Bearer $TOKEN" "$BASE/v2/$ITEM:fetchStatus" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("uploadState",""))' 2>/dev/null || echo "")
done

if [[ "$UPLOAD_STATE" != "SUCCEEDED" ]]; then
  err "Upload did not complete (state: ${UPLOAD_STATE:-unknown})"
  exit 1
fi
ok "package uploaded as a draft"

if [[ $DO_PUBLISH -eq 0 ]]; then
  warn "--no-publish: stopping before the review submission."
  exit 0
fi

# --- 4. Submit for review ----------------------------------------------------
info "submitting for review..."
PUBLISH=$(curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"publishType\": \"${PUBLISH_TYPE}\"}" \
  "${BASE}/v2/${ITEM}:publish")

if ! echo "$PUBLISH" | python3 -c 'import json,sys; json.load(sys.stdin)' 2>/dev/null; then
  err "Publish call failed:"
  echo "$PUBLISH"
  exit 1
fi

FINAL=$(echo "$PUBLISH" | python3 -c '
import json,sys
d = json.load(sys.stdin)
if "error" in d:
    print("ERROR: " + d["error"].get("message", "unknown error")); sys.exit(1)
print(d.get("status", "unknown"))
' 2>/dev/null || true)

if [[ -z "$FINAL" ]]; then
  err "Publish call returned an error:"
  echo "$PUBLISH" | python3 -m json.tool 2>/dev/null || echo "$PUBLISH"
  exit 1
fi

case "$FINAL" in
  *PENDING_REVIEW*|PUBLISHED*|*PUBLISH*)
    ok "submitted for review (state: $FINAL)"
    ;;
  *)
    warn "unexpected publish state: $FINAL"
    echo "$PUBLISH" | python3 -m json.tool 2>/dev/null || true
    ;;
esac

echo
info "Review usually takes a few hours to a few days."
info "Track it at https://chrome.google.com/webstore/devconsole"
