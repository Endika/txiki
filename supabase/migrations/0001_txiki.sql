create schema txiki;

create table txiki.links (
  code text primary key check (code ~ '^[0-9A-Za-z]{7}$'),
  target text not null,
  token_hash bytea not null,
  ask_location boolean not null default false,
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  last_click_at timestamptz
);

create table txiki.clicks (
  id bigint generated always as identity primary key,
  code text not null references txiki.links (code) on delete cascade,
  at timestamptz not null default now(),
  country text check (country ~ '^[A-Z]{2}$'),
  browser text not null,
  os text not null,
  device text not null,
  lang text,
  tz text,
  referrer_host text,
  visitor bytea not null,
  lat numeric(5, 2),
  lon numeric(5, 2),
  location_token_hash bytea,
  location_expires_at timestamptz
);
create index clicks_code_at_idx on txiki.clicks (code, at);
create index clicks_location_token_idx on txiki.clicks (location_token_hash)
  where location_token_hash is not null;

create table txiki.create_log (
  ip_hash bytea not null,
  at timestamptz not null default now()
);
create index create_log_at_idx on txiki.create_log (at);

create table txiki.salts (
  day date primary key,
  salt bytea not null
);

alter table txiki.links enable row level security;
alter table txiki.clicks enable row level security;
alter table txiki.create_log enable row level security;
alter table txiki.salts enable row level security;
revoke all on all tables in schema txiki from public, anon, authenticated, service_role;

grant usage on schema txiki to anon, service_role;

create function txiki.b64url(p_bytes bytea) returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select rtrim(translate(replace(encode(p_bytes, 'base64'), E'\n', ''), '+/', '-_'), '=')
$$;

create function txiki.token_hash(p_token text) returns bytea
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;
  return extensions.digest(decode(translate(p_token, '-_', '+/') || '=', 'base64'), 'sha256');
exception when others then
  return null;
end;
$$;

create function txiki.new_code() returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  v_code text := '';
  v_byte int;
begin
  while length(v_code) < 7 loop
    v_byte := get_byte(extensions.gen_random_bytes(1), 0);
    if v_byte < 248 then
      v_code := v_code || substr(v_alphabet, v_byte % 62 + 1, 1);
    end if;
  end loop;
  return v_code;
end;
$$;

create function txiki.salt_for(p_day date) returns bytea
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_salt bytea;
begin
  insert into txiki.salts (day, salt) values (p_day, extensions.gen_random_bytes(32))
  on conflict do nothing;
  select s.salt into v_salt from txiki.salts s where s.day = p_day;
  return v_salt;
end;
$$;

create function txiki.create_link(p_target text, p_ask_location boolean, p_ip text)
returns table (code text, token text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'UTC')::date;
  v_host text;
  v_path text;
  v_ip bytea := convert_to(coalesce(p_ip, ''), 'UTF8');
  v_hash_today bytea;
  v_hash_yesterday bytea;
  v_code text;
  v_raw bytea;
  v_attempt int := 0;
begin
  if p_target is null
    or length(p_target) > 2048
    or p_target ~ '[[:space:][:cntrl:]]'
    or lower(p_target) !~ '^https?://[^/?#]+'
  then
    raise exception 'invalid target';
  end if;

  v_host := lower(substring(p_target from '^[A-Za-z]+://([^/?#]*)'));
  v_host := regexp_replace(regexp_replace(v_host, '^.*@', ''), ':[0-9]*$', '');
  v_path := lower(coalesce(substring(p_target from '^[A-Za-z]+://[^/?#]*(/[^?#]*)'), ''));
  if v_host = 'endika.github.io' and v_path like '/txiki%' then
    raise exception 'invalid target';
  end if;

  perform pg_advisory_xact_lock(hashtext('txiki.create_link'));

  v_hash_today := extensions.digest(txiki.salt_for(v_today) || v_ip, 'sha256');
  v_hash_yesterday := extensions.digest(txiki.salt_for(v_today - 1) || v_ip, 'sha256');

  if (
    select count(*) from txiki.create_log l
    where l.at > now() - interval '1 hour' and l.ip_hash in (v_hash_today, v_hash_yesterday)
  ) >= 10 then
    raise exception 'rate limited';
  end if;

  if (select count(*) from txiki.links l where l.created_at > now() - interval '24 hours') >= 500 then
    raise exception 'capacity reached';
  end if;

  v_raw := extensions.gen_random_bytes(32);
  loop
    v_code := txiki.new_code();
    insert into txiki.links (code, target, token_hash, ask_location)
    values (v_code, p_target, extensions.digest(v_raw, 'sha256'), coalesce(p_ask_location, false))
    on conflict do nothing;
    exit when found;
    v_attempt := v_attempt + 1;
    if v_attempt >= 10 then
      raise exception 'capacity reached';
    end if;
  end loop;

  insert into txiki.create_log (ip_hash) values (v_hash_today);

  return query select v_code, txiki.b64url(v_raw);
end;
$$;

create function txiki.record_click(
  p_code text,
  p_ip text,
  p_country text,
  p_browser text,
  p_os text,
  p_device text,
  p_lang text,
  p_tz text,
  p_referrer_host text
)
returns table (target text, ask_location boolean, location_token text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_link txiki.links;
  v_browser text := left(coalesce(p_browser, 'Other'), 40);
  v_os text := left(coalesce(p_os, 'Other'), 40);
  v_device text := left(coalesce(p_device, 'desktop'), 40);
  v_visitor bytea;
  v_raw bytea;
  v_hash bytea;
  v_expires timestamptz;
begin
  if p_code is null or p_code !~ '^[0-9A-Za-z]{7}$' then
    return;
  end if;

  select * into v_link from txiki.links l where l.code = p_code and not l.disabled;
  if not found then
    return;
  end if;

  v_visitor := substr(
    extensions.digest(
      txiki.salt_for((now() at time zone 'UTC')::date)
        || convert_to(coalesce(p_ip, '') || v_browser || v_os || v_device, 'UTF8'),
      'sha256'),
    1, 16);

  if v_link.ask_location then
    v_raw := extensions.gen_random_bytes(32);
    v_hash := extensions.digest(v_raw, 'sha256');
    v_expires := now() + interval '10 minutes';
  end if;

  insert into txiki.clicks (
    code, country, browser, os, device, lang, tz, referrer_host, visitor,
    location_token_hash, location_expires_at
  ) values (
    p_code,
    case when p_country ~ '^[A-Z]{2}$' then p_country end,
    v_browser, v_os, v_device,
    left(p_lang, 35), left(p_tz, 64), left(p_referrer_host, 253),
    v_visitor, v_hash, v_expires
  );

  update txiki.links l set last_click_at = now() where l.code = p_code;

  return query select v_link.target, v_link.ask_location, txiki.b64url(v_raw);
end;
$$;

create function txiki.add_location(p_token text, p_lat double precision, p_lon double precision)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea := txiki.token_hash(p_token);
begin
  if v_hash is null
    or p_lat is null or p_lon is null
    or p_lat not between -90 and 90
    or p_lon not between -180 and 180
  then
    return false;
  end if;

  update txiki.clicks c
  set lat = round(p_lat::numeric, 2),
      lon = round(p_lon::numeric, 2),
      location_token_hash = null,
      location_expires_at = null
  where c.location_token_hash = v_hash and c.location_expires_at > now();
  return found;
end;
$$;

create function txiki.link_stats(p_code text, p_token text, p_tz text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea := txiki.token_hash(p_token);
  v_link txiki.links;
  v_tz text;
  v_total bigint;
  v_uniques bigint;
  v_first timestamptz;
  v_last timestamptz;
begin
  select * into v_link from txiki.links l where l.code = p_code and l.token_hash = v_hash;
  if not found then
    return null;
  end if;

  v_tz := case
    when exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_tz) then p_tz
    else 'UTC'
  end;

  select count(*), count(distinct (c.visitor, (c.at at time zone 'UTC')::date)), min(c.at), max(c.at)
  into v_total, v_uniques, v_first, v_last
  from txiki.clicks c where c.code = p_code;

  return jsonb_build_object(
    'target', v_link.target,
    'created_at', v_link.created_at,
    'ask_location', v_link.ask_location,
    'disabled', v_link.disabled,
    'total', v_total,
    'uniques', v_uniques,
    'first_at', v_first,
    'last_at', v_last,
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', s.d, 'count', s.n) order by s.d), '[]'::jsonb)
      from (
        select to_char(c.at at time zone v_tz, 'YYYY-MM-DD') d, count(*) n
        from txiki.clicks c where c.code = p_code group by 1
      ) s
    ),
    'by_hour', (
      select jsonb_agg(coalesce(s.n, 0) order by h.h)
      from generate_series(0, 23) h (h)
      left join (
        select extract(hour from c.at at time zone v_tz)::int hr, count(*) n
        from txiki.clicks c where c.code = p_code group by 1
      ) s on s.hr = h.h
    ),
    'countries', (
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.country k, count(*) n from txiki.clicks c where c.code = p_code group by 1) s
    ),
    'browsers', (
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.browser k, count(*) n from txiki.clicks c where c.code = p_code group by 1) s
    ),
    'os', (
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.os k, count(*) n from txiki.clicks c where c.code = p_code group by 1) s
    ),
    'devices', (
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.device k, count(*) n from txiki.clicks c where c.code = p_code group by 1) s
    ),
    'referrers', (
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.referrer_host k, count(*) n from txiki.clicks c where c.code = p_code group by 1) s
    ),
    'langs', (
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.lang k, count(*) n from txiki.clicks c where c.code = p_code group by 1) s
    ),
    'recent', (
      select coalesce(jsonb_agg(to_jsonb(s) order by s.at desc, s.id desc), '[]'::jsonb)
      from (
        select c.id, c.at, c.country, c.browser, c.os, c.device, c.referrer_host
        from txiki.clicks c where c.code = p_code
        order by c.at desc, c.id desc limit 50
      ) s
    ),
    'points', (
      select coalesce(jsonb_agg(jsonb_build_object('lat', s.lat, 'lon', s.lon, 'at', s.at) order by s.at desc, s.id desc), '[]'::jsonb)
      from (
        select c.id, c.lat, c.lon, c.at
        from txiki.clicks c where c.code = p_code and c.lat is not null
        order by c.at desc, c.id desc limit 500
      ) s
    )
  );
end;
$$;

create function txiki.delete_link(p_code text, p_token text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea := txiki.token_hash(p_token);
begin
  if v_hash is null then
    return false;
  end if;
  delete from txiki.links l where l.code = p_code and l.token_hash = v_hash;
  return found;
end;
$$;

revoke all on all functions in schema txiki from public, anon, authenticated, service_role;
grant execute on function txiki.create_link(text, boolean, text) to service_role;
grant execute on function txiki.record_click(text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function txiki.link_stats(text, text, text) to anon;
grant execute on function txiki.delete_link(text, text) to anon;
grant execute on function txiki.add_location(text, double precision, double precision) to anon;

select cron.schedule(
  'txiki-retention',
  '30 3 * * *',
  $$
  delete from txiki.clicks where at < now() - interval '12 months';
  delete from txiki.links where coalesce(last_click_at, created_at) < now() - interval '12 months';
  delete from txiki.create_log where at < now() - interval '2 days';
  delete from txiki.salts where day < (now() at time zone 'UTC')::date - 1;
  $$
);
