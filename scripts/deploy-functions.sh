#!/usr/bin/env bash
# Builds the geo table and deploys txiki-create and txiki-click to production. Run from the repo root.
# GEO_CSV=<path>  use a local DB-IP CSV instead of downloading the current month.
# NESTED=1        upload the nested layout (txiki-click/index.ts + _shared/*.ts, unverified against the API)
#                 instead of the default flat one (imports rewritten ../_shared/ -> ./, proven by the spike).
# DRY_RUN=1       print URLs, files and metadata; no API calls. The secret file is only checked to be
#                 non-empty; its value is neither sent nor printed.
set -euo pipefail

REF=ahvzkoekmwqwozqsgeao
API="https://api.supabase.com/v1/projects/$REF"
BASE="https://$REF.supabase.co/functions/v1"
TOKEN_FILE="$HOME/.config/supabase/mcp-token"
SECRET_FILE="$HOME/.config/txiki/turnstile-secret"
FN_DIR="supabase/functions"

DRY_RUN=${DRY_RUN:-}
NESTED=${NESTED:-}

if [ -z "$DRY_RUN" ]; then
  [ -r "$TOKEN_FILE" ] || { echo "missing $TOKEN_FILE" >&2; exit 1; }
  TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")
fi

auth_header() { printf 'Authorization: Bearer %s\n' "$TOKEN"; }

# Runs the SQL on stdin; on a non-2xx answer prints the response body to stderr and fails.
q() {
  local out status
  out=$(mktemp)
  status=$(python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' \
    | curl -sS -o "$out" -w '%{http_code}' -X POST "$API/database/query" \
      -H @<(auth_header) -H "Content-Type: application/json" --data-binary @-) || {
    cat "$out" >&2; rm -f "$out"; return 1
  }
  if [ "${status#2}" = "$status" ]; then
    echo "query failed (HTTP $status):" >&2
    cat "$out" >&2; echo >&2; rm -f "$out"; return 1
  fi
  cat "$out"; rm -f "$out"
}

if [ ! -s "$SECRET_FILE" ] || [ -z "$(tr -d '[:space:]' < "$SECRET_FILE")" ]; then
  echo "missing or empty $SECRET_FILE: put the Cloudflare Turnstile secret key there (chmod 600)" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ -z "$DRY_RUN" ]; then
  exists=$(printf '%s' "select count(*) from pg_namespace where nspname='txiki'" | q \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["count"])')
  [ "$exists" != 0 ] || { echo "schema txiki does not exist: run scripts/apply-prod.sh first" >&2; exit 1; }
fi

echo "1/4 setting TURNSTILE_SECRET"
echo "    POST $API/secrets"
if [ -n "$DRY_RUN" ]; then
  echo "    dry run: secret file is non-empty, value not read"
else
  python3 -c 'import json,sys; print(json.dumps([{"name": "TURNSTILE_SECRET", "value": sys.stdin.read().strip()}]))' < "$SECRET_FILE" \
    | curl -sS --fail-with-body -X POST "$API/secrets" \
      -H @<(auth_header) -H "Content-Type: application/json" \
      --data-binary @- > /dev/null
  echo "    secret set"
fi

echo "2/4 building the geo table"
if [ -n "${GEO_CSV:-}" ]; then
  node scripts/build-geo.mjs --csv "$GEO_CSV"
else
  node scripts/build-geo.mjs
fi

shared_for() {
  case $1 in
    txiki-create) echo "deps.ts env.ts handlers.ts request.ts ua.ts" ;;
    txiki-click) echo "deps.ts env.ts handlers.ts request.ts ua.ts geo.ts geo-data.ts" ;;
    *) echo "unknown function $1" >&2; return 1 ;;
  esac
}

deploy() {
  local slug=$1 entry names f src dest
  local -a args=()
  local -a listing=()
  if [ -z "$NESTED" ]; then
    entry=index.ts
    rm -rf "${TMP:?}/$slug" && mkdir -p "$TMP/$slug"
    sed 's#\.\./_shared/#./#g' "$FN_DIR/$slug/index.ts" > "$TMP/$slug/index.ts"
    listing+=("$TMP/$slug/index.ts|index.ts")
    for f in $(shared_for "$slug"); do
      cp "$FN_DIR/_shared/$f" "$TMP/$slug/$f"
      listing+=("$TMP/$slug/$f|$f")
    done
  else
    entry="$slug/index.ts"
    listing+=("$FN_DIR/$slug/index.ts|$slug/index.ts")
    for f in $(shared_for "$slug"); do
      listing+=("$FN_DIR/_shared/$f|_shared/$f")
    done
  fi

  local metadata
  metadata=$(printf '{"entrypoint_path":"%s","name":"%s","verify_jwt":false}' "$entry" "$slug")
  local url="$API/functions/deploy?slug=$slug"

  echo "    POST $url"
  echo "    metadata: $metadata"
  for names in "${listing[@]}"; do
    src=${names%%|*}
    dest=${names##*|}
    printf '    file %-28s %8s bytes\n' "$dest" "$(wc -c < "$src")"
    args+=(-F "file=@$src;filename=$dest;type=application/typescript")
  done

  [ -n "$DRY_RUN" ] && return 0

  local body="$TMP/$slug.response" status
  status=$(curl -sS -o "$body" -w '%{http_code}' -X POST "$url" \
    -H @<(auth_header) \
    -F "metadata=$metadata;type=application/json" \
    "${args[@]}") || { echo "    request failed" >&2; cat "$body" >&2 2>/dev/null || true; exit 1; }
  if [ "${status#2}" = "$status" ]; then
    echo "    deploy of $slug FAILED (HTTP $status), API response:" >&2
    cat "$body" >&2
    echo >&2
    [ -n "$NESTED" ] && echo "    the nested layout is unverified; retry without NESTED=1" >&2
    exit 1
  fi
  echo "    deployed $slug (HTTP $status)"
}

echo "3/4 deploying functions${NESTED:+ (nested layout)}"
for slug in txiki-create txiki-click; do
  echo "  $slug"
  deploy "$slug"
done

echo "4/4 smoke tests"
echo "    OPTIONS $BASE/txiki-create (expect 204)"
echo "    OPTIONS $BASE/txiki-click (expect 204)"
echo "    POST $BASE/txiki-click {\"code\":\"0000000\"} (expect 404 not_found)"
if [ -n "$DRY_RUN" ]; then
  echo "dry run: nothing sent"
  exit 0
fi

fail=0
for slug in txiki-create txiki-click; do
  status=$(curl -sS -o /dev/null -w '%{http_code}' -X OPTIONS -H 'Origin: https://endika.github.io' "$BASE/$slug")
  if [ "$status" = 204 ]; then echo "    PASS OPTIONS $slug 204"; else echo "    FAIL OPTIONS $slug expected 204, got $status"; fail=1; fi
done

status=$(curl -sS -o "$TMP/click.out" -w '%{http_code}' -X POST "$BASE/txiki-click" \
  -H 'Origin: https://endika.github.io' -H 'Content-Type: application/json' \
  --data '{"code":"0000000"}')
if [ "$status" = 404 ] && grep -q not_found "$TMP/click.out"; then
  echo "    PASS POST 404 not_found"
else
  echo "    FAIL POST expected 404 not_found, got $status: $(cat "$TMP/click.out")"
  fail=1
fi

[ "$fail" = 0 ] || { echo "smoke tests FAILED" >&2; exit 1; }
echo "done."
