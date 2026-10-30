#!/usr/bin/env bash
# Loads the monthly DB-IP Lite network (ASN) and Spanish city data into production; safe to re-run.
# Extra arguments go to scripts/build-geo-db.mjs (--asn, --city for local files).
# PSQL="psql <url>" sends the SQL through psql instead of the API (local testing only).
set -euo pipefail

cd "$(dirname "$0")/.."

REF=ahvzkoekmwqwozqsgeao
API="https://api.supabase.com/v1/projects/$REF"
TOKEN_FILE="$HOME/.config/supabase/mcp-token"

if [ -n "${PSQL:-}" ]; then
  case "$PSQL" in
    *://*)
      host=${PSQL#*://}
      host=${host##*@}
      host=${host%%[/:? ]*}
      if [ "$host" != localhost ] && [ "$host" != 127.0.0.1 ]; then
        echo "refusing to run: PSQL host must be localhost or 127.0.0.1" >&2
        exit 2
      fi
      ;;
    "docker exec "*) ;;
    *) echo "refusing to run: PSQL must be a localhost URL or a docker exec command" >&2; exit 2 ;;
  esac
else
  [ -r "$TOKEN_FILE" ] || { echo "missing $TOKEN_FILE" >&2; exit 1; }
  TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")
fi

auth_header() { printf 'Authorization: Bearer %s\n' "$TOKEN"; }

# Runs the SQL on stdin; on a non-2xx answer prints the response body to stderr and fails.
q() {
  if [ -n "${PSQL:-}" ]; then
    $PSQL -v ON_ERROR_STOP=1 -q -At
    return
  fi
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

# Prints each row of the one-statement query on stdin as pipe-separated values.
rows() {
  if [ -n "${PSQL:-}" ]; then
    q | tr -d '\r'
  else
    q | python3 -c 'import json,sys; [print(" | ".join(str(v) for v in r.values())) for r in json.load(sys.stdin)]'
  fi
}

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT

echo "1/5 building SQL batches"
node scripts/build-geo-db.mjs --out "$dir" "$@"

echo "2/5 creating staging tables"
q > /dev/null <<'SQL'
drop table if exists txiki.asn_orgs_load, txiki.asn_ranges_load, txiki.city_es_ranges_load;
create unlogged table txiki.asn_orgs_load (id int, name text);
create unlogged table txiki.asn_ranges_load (ip_start inet, ip_end inet, org_id int);
create unlogged table txiki.city_es_ranges_load (ip_start inet, ip_end inet, city text, region text);
alter table txiki.asn_orgs_load enable row level security;
alter table txiki.asn_ranges_load enable row level security;
alter table txiki.city_es_ranges_load enable row level security;
revoke all on table txiki.asn_orgs_load, txiki.asn_ranges_load, txiki.city_es_ranges_load from public, anon, authenticated, service_role;
SQL

echo "3/5 sending batches"
total=$(find "$dir" -name '*.sql' | wc -l)
n=0
for f in "$dir"/*.sql; do
  q < "$f" > /dev/null
  n=$((n + 1))
  if [ $((n % 10)) = 0 ] || [ "$n" = "$total" ]; then echo "    $n/$total"; fi
done

echo "4/5 swapping into the real tables"
q > /dev/null <<'SQL'
begin;
truncate txiki.asn_orgs, txiki.asn_ranges, txiki.city_es_ranges;
insert into txiki.asn_orgs select distinct on (id) id, name from txiki.asn_orgs_load order by id;
insert into txiki.asn_ranges select distinct on (ip_start) ip_start, ip_end, org_id from txiki.asn_ranges_load order by ip_start;
insert into txiki.city_es_ranges select distinct on (ip_start) ip_start, ip_end, city, region from txiki.city_es_ranges_load order by ip_start;
drop table txiki.asn_orgs_load, txiki.asn_ranges_load, txiki.city_es_ranges_load;
commit;
SQL

echo "5/5 verifying"
sample=$(tr -d '[:space:]' < "$dir/sample-es-ip.txt")
if ! [[ "$sample" =~ ^[0-9.]*$ ]]; then echo "bad sample IP: $sample" >&2; exit 1; fi
rows <<'SQL'
select
  (select count(*) from txiki.asn_orgs) as orgs,
  (select count(*) from txiki.asn_ranges) as asn_ranges,
  (select count(*) from txiki.city_es_ranges) as es_city_ranges
SQL
if [ -n "$sample" ]; then
  rows <<SQL
select txiki.network_for('8.8.8.8') as network, txiki.city_for('$sample') as city
SQL
fi
