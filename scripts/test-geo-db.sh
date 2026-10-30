#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -n "${TXIKI_TEST_DATABASE_URL:-}" ]; then
  host=${TXIKI_TEST_DATABASE_URL#*://}
  host=${host##*@}
  host=${host%%[/:?]*}
  if [ "$host" != localhost ] && [ "$host" != 127.0.0.1 ]; then
    echo "refusing to run: TXIKI_TEST_DATABASE_URL host must be localhost or 127.0.0.1 (the tests delete rows)" >&2
    exit 2
  fi
  export PSQL="psql $TXIKI_TEST_DATABASE_URL"
else
  name="txiki-geo-$$"
  docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=postgres postgres:17 > /dev/null
  trap 'docker rm -f "$name" > /dev/null 2>&1 || true' EXIT
  until docker exec "$name" pg_isready -U postgres -h localhost > /dev/null 2>&1; do sleep 1; done
  sleep 2
  export PSQL="docker exec -i $name psql -U postgres"
fi

run() { $PSQL -v ON_ERROR_STOP=1 -q "$@"; }

run < supabase/tests/bootstrap.sql
for m in supabase/migrations/000[1-4]_*.sql; do run < "$m"; done

load() {
  bash scripts/load-geo-db.sh \
    --asn supabase/tests/fixtures/dbip-asn-lite.csv \
    --city supabase/tests/fixtures/dbip-city-lite.csv
}

check() {
  local got
  got=$(run -At <<'SQL'
select concat_ws('|',
  (select count(*) from txiki.asn_orgs),
  (select count(*) from txiki.asn_ranges),
  (select count(*) from txiki.city_es_ranges),
  txiki.network_for('1.0.0.7'),
  txiki.network_for('8.8.8.8'),
  txiki.network_for('80.58.3.3'),
  txiki.network_for('2001:4860::8888'),
  coalesce(txiki.network_for('9.9.9.9'), 'none'),
  txiki.city_for('80.58.10.5'),
  txiki.city_for('80.58.11.5'),
  txiki.city_for('2a02:9000::1'),
  coalesce(txiki.city_for('8.8.4.4'), 'none'),
  (select count(*) from pg_class where relname like '%\_load' and relnamespace = 'txiki'::regnamespace),
  (select bool_and(relrowsecurity) from pg_class where oid in ('txiki.asn_orgs'::regclass, 'txiki.asn_ranges'::regclass, 'txiki.city_es_ranges'::regclass)))
SQL
  )
  local want="3|5|3|Cloudflare, Inc.|Google LLC|O'Brien Telefonica de Espana|Google LLC|none|Pozuelo de Alarcón, Madrid|Madrid|Vigo, Galicia|none|0|t"
  if [ "$got" != "$want" ]; then
    echo "FAIL ($1)" >&2
    echo "  got:  $got" >&2
    echo "  want: $want" >&2
    exit 1
  fi
  echo "PASS ($1)"
}

load
check "first load"
load
check "re-run"
