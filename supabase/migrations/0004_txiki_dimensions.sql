create table txiki.asn_orgs (
  id int primary key,
  name text not null
);

create table txiki.asn_ranges (
  ip_start inet primary key,
  ip_end inet not null,
  org_id int not null
);

create table txiki.city_es_ranges (
  ip_start inet primary key,
  ip_end inet not null,
  city text not null,
  region text
);

alter table txiki.asn_orgs enable row level security;
alter table txiki.asn_ranges enable row level security;
alter table txiki.city_es_ranges enable row level security;
revoke all on table txiki.asn_orgs, txiki.asn_ranges, txiki.city_es_ranges from public, anon, authenticated, service_role;

comment on table txiki.asn_ranges is 'IP ranges to network organisations (DB-IP Lite, CC BY 4.0); read only by the lookup functions';
comment on table txiki.city_es_ranges is 'Spanish IP ranges to city and region (DB-IP Lite, CC BY 4.0); read only by the lookup functions';

alter table txiki.clicks
  add column network text,
  add column city text,
  add column model text,
  add column screen text check (screen in ('small-phone', 'phone', 'tablet', 'laptop', 'large')),
  add column channel text check (channel ~ '^[a-z0-9-]{1,24}$');

comment on column txiki.clicks.network is 'PII: network/organisation name derived from the IP, which is discarded';
comment on column txiki.clicks.city is 'PII: city derived from the IP, which is discarded';
comment on column txiki.clicks.model is 'PII: device model reported by the browser';
comment on column txiki.clicks.screen is 'Screen size class';
comment on column txiki.clicks.channel is 'Channel tag chosen by the link creator';

create function txiki.network_for(p_ip inet) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(o.name, 80)
  from (
    select r.ip_end, r.org_id
    from txiki.asn_ranges r
    where family(r.ip_start) = family(p_ip) and r.ip_start <= p_ip
    order by r.ip_start desc
    limit 1
  ) r
  join txiki.asn_orgs o on o.id = r.org_id
  where r.ip_end >= p_ip
$$;

create function txiki.city_for(p_ip inet) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(
    case when r.region is null or r.region = r.city then r.city else r.city || ', ' || r.region end,
    80)
  from (
    select c.ip_end, c.city, c.region
    from txiki.city_es_ranges c
    where family(c.ip_start) = family(p_ip) and c.ip_start <= p_ip
    order by c.ip_start desc
    limit 1
  ) r
  where r.ip_end >= p_ip
$$;

drop function txiki.record_click(text, text, text, text, text, text, text, text, text, boolean);

create function txiki.record_click(
  p_code text,
  p_ip text,
  p_country text,
  p_browser text,
  p_os text,
  p_device text,
  p_lang text,
  p_tz text,
  p_referrer_host text,
  p_bot boolean default false,
  p_model text default null,
  p_screen text default null,
  p_channel text default null
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
  v_ip inet;
  v_network text;
  v_city text;
  v_country text := case when p_country ~ '^[A-Z]{2}$' then p_country end;
begin
  if p_code is null or p_code !~ '^[0-9A-Za-z]{7}$' then
    return;
  end if;

  select * into v_link from txiki.links l where l.code = p_code and not l.disabled;
  if not found then
    return;
  end if;

  begin
    v_ip := host(p_ip::inet)::inet;
  exception when others then
    v_ip := null;
  end;
  if v_ip is not null then
    v_network := txiki.network_for(v_ip);
    if v_country = 'ES' then
      v_city := txiki.city_for(v_ip);
    end if;
  end if;

  v_visitor := substr(
    extensions.digest(
      txiki.salt_for((now() at time zone 'UTC')::date)
        || convert_to(coalesce(p_ip, '') || v_browser || v_os || v_device, 'UTF8'),
      'sha256'),
    1, 16);

  if v_link.ask_location and not coalesce(p_bot, false) then
    v_raw := extensions.gen_random_bytes(32);
    v_hash := extensions.digest(v_raw, 'sha256');
    v_expires := now() + interval '10 minutes';
  end if;

  insert into txiki.clicks (
    code, country, browser, os, device, lang, tz, referrer_host, visitor,
    location_token_hash, location_expires_at, bot,
    network, city, model, screen, channel
  ) values (
    p_code,
    v_country,
    v_browser, v_os, v_device,
    left(p_lang, 35), left(p_tz, 64), left(p_referrer_host, 253),
    v_visitor, v_hash, v_expires, coalesce(p_bot, false),
    v_network, v_city,
    case when p_model ~ '^[A-Za-z0-9 ._+()-]{1,40}$' then p_model end,
    case when p_screen in ('small-phone', 'phone', 'tablet', 'laptop', 'large') then p_screen end,
    case when p_channel ~ '^[a-z0-9-]{1,24}$' then p_channel end
  );

  update txiki.links l set last_click_at = now() where l.code = p_code;

  return query select v_link.target, v_link.ask_location, txiki.b64url(v_raw);
end;
$$;

create or replace function txiki.link_stats(p_code text, p_token text, p_tz text)
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
  v_bots bigint;
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
  from txiki.clicks c where c.code = p_code and not c.bot;

  select count(*) into v_bots from txiki.clicks c where c.code = p_code and c.bot;

  return jsonb_build_object(
    'target', v_link.target,
    'created_at', v_link.created_at,
    'ask_location', v_link.ask_location,
    'note', v_link.note,
    'disabled', v_link.disabled,
    'total', v_total,
    'uniques', v_uniques,
    'first_at', v_first,
    'last_at', v_last,
    'bots', v_bots,
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', s.d, 'count', s.n) order by s.d), '[]'::jsonb)
      from (
        select to_char(c.at at time zone v_tz, 'YYYY-MM-DD') d, count(*) n
        from txiki.clicks c where c.code = p_code and not c.bot group by 1
      ) s
    ),
    'by_hour', (
      select jsonb_agg(coalesce(s.n, 0) order by h.h)
      from generate_series(0, 23) h (h)
      left join (
        select extract(hour from c.at at time zone v_tz)::int hr, count(*) n
        from txiki.clicks c where c.code = p_code and not c.bot group by 1
      ) s on s.hr = h.h
    ),
    'countries', txiki.top_list((
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.country k, count(*) n from txiki.clicks c where c.code = p_code and not c.bot group by 1) s
    )),
    'browsers', txiki.top_list((
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.browser k, count(*) n from txiki.clicks c where c.code = p_code and not c.bot group by 1) s
    )),
    'os', txiki.top_list((
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.os k, count(*) n from txiki.clicks c where c.code = p_code and not c.bot group by 1) s
    )),
    'devices', txiki.top_list((
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.device k, count(*) n from txiki.clicks c where c.code = p_code and not c.bot group by 1) s
    )),
    'referrers', txiki.top_list((
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.referrer_host k, count(*) n from txiki.clicks c where c.code = p_code and not c.bot group by 1) s
    )),
    'langs', txiki.top_list((
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.lang k, count(*) n from txiki.clicks c where c.code = p_code and not c.bot group by 1) s
    )),
    'networks', txiki.top_list((
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.network k, count(*) n from txiki.clicks c where c.code = p_code and not c.bot group by 1) s
    )),
    'cities', txiki.top_list((
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.city k, count(*) n from txiki.clicks c where c.code = p_code and not c.bot group by 1) s
    )),
    'models', txiki.top_list((
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.model k, count(*) n from txiki.clicks c where c.code = p_code and not c.bot group by 1) s
    )),
    'screens', txiki.top_list((
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.screen k, count(*) n from txiki.clicks c where c.code = p_code and not c.bot group by 1) s
    )),
    'channels', txiki.top_list((
      select coalesce(jsonb_agg(jsonb_build_object('key', s.k, 'count', s.n) order by s.n desc, s.k), '[]'::jsonb)
      from (select c.channel k, count(*) n from txiki.clicks c where c.code = p_code and not c.bot group by 1) s
    )),
    'recent', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'at', s.at, 'country', s.country, 'browser', s.browser, 'os', s.os,
          'device', s.device, 'referrer_host', s.referrer_host,
          'network', s.network, 'city', s.city, 'channel', s.channel
        ) order by s.at desc, s.id desc), '[]'::jsonb)
      from (
        select c.id, c.at, c.country, c.browser, c.os, c.device, c.referrer_host, c.network, c.city, c.channel
        from txiki.clicks c where c.code = p_code and not c.bot
        order by c.at desc, c.id desc limit 50
      ) s
    ),
    'points', (
      select coalesce(jsonb_agg(jsonb_build_object('lat', s.lat, 'lon', s.lon, 'at', s.at) order by s.at desc, s.id desc), '[]'::jsonb)
      from (
        select c.id, c.lat, c.lon, c.at
        from txiki.clicks c where c.code = p_code and not c.bot and c.lat is not null
        order by c.at desc, c.id desc limit 500
      ) s
    )
  );
end;
$$;

revoke all on function txiki.network_for(inet) from public, anon, authenticated, service_role;
revoke all on function txiki.city_for(inet) from public, anon, authenticated, service_role;
revoke all on function txiki.record_click(text, text, text, text, text, text, text, text, text, boolean, text, text, text) from public, anon, authenticated, service_role;
grant execute on function txiki.record_click(text, text, text, text, text, text, text, text, text, boolean, text, text, text) to service_role;
revoke all on function txiki.link_stats(text, text, text) from public, anon, authenticated, service_role;
grant execute on function txiki.link_stats(text, text, text) to anon;
