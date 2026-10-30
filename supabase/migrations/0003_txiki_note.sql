alter table txiki.links add column note text check (note is null or (note ~ '^[A-Za-z0-9_-]+$' and length(note) between 22 and 600));
comment on column txiki.links.note is 'Creator note, AES-GCM ciphertext encrypted client-side; the server cannot read it';

create function txiki.set_note(p_code text, p_token text, p_note text) returns boolean
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
  update txiki.links l set note = nullif(p_note, '') where l.code = p_code and l.token_hash = v_hash;
  return found;
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

revoke all on function txiki.set_note(text, text, text) from public, anon, authenticated, service_role;
grant execute on function txiki.set_note(text, text, text) to anon;
revoke all on function txiki.link_stats(text, text, text) from public, anon, authenticated, service_role;
grant execute on function txiki.link_stats(text, text, text) to anon;
