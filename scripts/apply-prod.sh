#!/usr/bin/env bash
# Applies supabase/migrations/0001_txiki.sql, 0002_txiki_bots.sql and 0003_txiki_note.sql to production; safe to re-run.
set -euo pipefail

cd "$(dirname "$0")/.."

REF=ahvzkoekmwqwozqsgeao
API="https://api.supabase.com/v1/projects/$REF"
TOKEN_FILE="$HOME/.config/supabase/mcp-token"

[ -r "$TOKEN_FILE" ] || { echo "missing $TOKEN_FILE" >&2; exit 1; }
TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")

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

get_db_schema() {
  curl -sS --fail-with-body "$API/postgrest" -H @<(auth_header) \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["db_schema"])'
}

echo "1/7 pre-check: does schema txiki exist?"
count=$(printf '%s' "select count(*) from pg_namespace where nspname='txiki'" | q \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["count"])')

if [ "$count" != 0 ]; then
  echo "2/7 schema exists, skipping DDL"
else
  echo "2/7 applying supabase/migrations/0001_txiki.sql"
  out=$(q < supabase/migrations/0001_txiki.sql)
  echo "    response: $out"
fi

echo "3/7 registering migration 0001"
printf '%s' "insert into supabase_migrations.schema_migrations(version, name) values ('20261030000000', 'txiki_0001') on conflict do nothing" | q > /dev/null

echo "4/7 applying supabase/migrations/0002_txiki_bots.sql if needed"
has_bot=$(printf '%s' "select count(*) from information_schema.columns where table_schema='txiki' and table_name='clicks' and column_name='bot'" | q \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["count"])')
if [ "$has_bot" != 0 ]; then
  echo "    column txiki.clicks.bot exists, skipping DDL"
else
  out=$(q < supabase/migrations/0002_txiki_bots.sql)
  echo "    response: $out"
  printf '%s' "insert into supabase_migrations.schema_migrations(version, name) values ('20261030120000', 'txiki_0002_bots') on conflict do nothing" | q > /dev/null
fi

echo "5/7 applying supabase/migrations/0003_txiki_note.sql if needed"
has_note=$(printf '%s' "select count(*) from information_schema.columns where table_schema='txiki' and table_name='links' and column_name='note'" | q \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["count"])')
if [ "$has_note" != 0 ]; then
  echo "    column txiki.links.note exists, skipping DDL"
else
  out=$(q < supabase/migrations/0003_txiki_note.sql)
  echo "    response: $out"
  printf '%s' "insert into supabase_migrations.schema_migrations(version, name) values ('20261031000000', 'txiki_0003_note') on conflict do nothing" | q > /dev/null
fi

echo "6/7 exposing schema txiki in PostgREST"
current=$(get_db_schema)
case ",$(printf '%s' "$current" | tr -d ' ')," in
  *,public,*) ;;
  *) echo "    refusing to touch db_schema: empty or without public ('$current')" >&2; exit 1 ;;
esac
if printf '%s' "$current" | python3 -c 'import sys; sys.exit(0 if "txiki" in [s.strip() for s in sys.stdin.read().split(",")] else 1)'; then
  echo "    already exposed: $current"
  expected=$current
else
  expected="$current,txiki"
  CURRENT="$current" python3 -c 'import json,os; print(json.dumps({"db_schema": os.environ["CURRENT"] + ",txiki"}))' \
    | curl -sS --fail-with-body -X PATCH "$API/postgrest" \
      -H @<(auth_header) -H "Content-Type: application/json" \
      --data-binary @- > /dev/null
fi
after=$(get_db_schema)
if [ "$after" != "$expected" ]; then
  echo "    db_schema mismatch: expected '$expected', got '$after'" >&2
  exit 1
fi
echo "    db_schema: $after"

echo "7/7 verifying"
checks=$(q <<'SQL'
select
  not exists (
    select 1
    from unnest(array['anon','authenticated']) r,
         unnest(array['links','clicks','create_log','salts']) t,
         unnest(array['select','insert','update','delete']) p
    where has_table_privilege(r, 'txiki.' || t, p)
  ) as roles_have_no_table_privileges,
  has_function_privilege('anon', 'txiki.link_stats(text,text,text)', 'execute') as anon_link_stats,
  has_function_privilege('anon', 'txiki.delete_link(text,text)', 'execute') as anon_delete_link,
  has_function_privilege('anon', 'txiki.add_location(text,double precision,double precision)', 'execute') as anon_add_location,
  has_function_privilege('anon', 'txiki.set_note(text,text,text)', 'execute') as anon_set_note,
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join unnest(array['anon','authenticated']) r
    where n.nspname = 'txiki'
      and has_function_privilege(r, p.oid, 'execute')
      and not (r = 'anon' and p.oid in (
        'txiki.link_stats(text,text,text)'::regprocedure,
        'txiki.delete_link(text,text)'::regprocedure,
        'txiki.set_note(text,text,text)'::regprocedure,
        'txiki.add_location(text,double precision,double precision)'::regprocedure))
  ) as no_other_function_execute,
  has_function_privilege('service_role', 'txiki.create_link(text,boolean,text)', 'execute') as service_create_link,
  has_function_privilege('service_role', 'txiki.record_click(text,text,text,text,text,text,text,text,text,boolean)', 'execute') as service_record_click,
  not has_function_privilege('anon', 'txiki.record_click(text,text,text,text,text,text,text,text,text,boolean)', 'execute') as anon_record_click,
  exists (select 1 from information_schema.columns
          where table_schema = 'txiki' and table_name = 'clicks' and column_name = 'bot') as bot_column,
  exists (select 1 from information_schema.columns
          where table_schema = 'txiki' and table_name = 'links' and column_name = 'note') as note_column,
  coalesce((select bool_and(relrowsecurity) from pg_class
            where oid = any(array['txiki.links'::regclass, 'txiki.clicks'::regclass,
                                  'txiki.create_log'::regclass, 'txiki.salts'::regclass])), false) as rls_on_all_tables,
  exists (select 1 from cron.job where jobname = 'txiki-retention' and schedule = '30 3 * * *') as retention_cron
SQL
)
printf '%s' "$checks" | python3 -c '
import json, sys
r = json.load(sys.stdin)[0]
bad = [k for k, v in r.items() if not v]
for k, v in r.items():
    print("    %s %s" % ("PASS" if v else "FAIL", k))
sys.exit(1 if bad else 0)
' || { echo "verification FAILED" >&2; exit 1; }

echo "done. Now run the Supabase advisors (security and performance) on $REF."
