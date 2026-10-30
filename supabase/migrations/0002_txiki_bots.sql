alter table txiki.clicks add column bot boolean not null default false;
comment on column txiki.clicks.bot is 'Flag: the visit came from an automated browser or a known crawler; excluded from every statistic';

drop function txiki.record_click(text, text, text, text, text, text, text, text, text);

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
  p_bot boolean default false
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

  if v_link.ask_location and not coalesce(p_bot, false) then
    v_raw := extensions.gen_random_bytes(32);
    v_hash := extensions.digest(v_raw, 'sha256');
    v_expires := now() + interval '10 minutes';
  end if;

  insert into txiki.clicks (
    code, country, browser, os, device, lang, tz, referrer_host, visitor,
    location_token_hash, location_expires_at, bot
  ) values (
    p_code,
    case when p_country ~ '^[A-Z]{2}$' then p_country end,
    v_browser, v_os, v_device,
    left(p_lang, 35), left(p_tz, 64), left(p_referrer_host, 253),
    v_visitor, v_hash, v_expires, coalesce(p_bot, false)
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
    'recent', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'at', s.at, 'country', s.country, 'browser', s.browser, 'os', s.os,
          'device', s.device, 'referrer_host', s.referrer_host
        ) order by s.at desc, s.id desc), '[]'::jsonb)
      from (
        select c.id, c.at, c.country, c.browser, c.os, c.device, c.referrer_host
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

revoke all on function txiki.record_click(text, text, text, text, text, text, text, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function txiki.record_click(text, text, text, text, text, text, text, text, text, boolean) to service_role;
revoke all on function txiki.link_stats(text, text, text) from public, anon, authenticated, service_role;
grant execute on function txiki.link_stats(text, text, text) to anon;
