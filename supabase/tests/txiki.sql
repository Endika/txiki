\set ON_ERROR_STOP on

create schema t;
grant usage on schema t to anon, service_role;

create function t.err(q text) returns text language plpgsql as $$
begin
  execute q;
  return null;
exception when others then
  return sqlerrm;
end
$$;

create function t.reset() returns void language sql as $$
  delete from txiki.clicks;
  delete from txiki.links;
  delete from txiki.create_log;
  delete from txiki.salts;
$$;

create function t.today() returns date language sql as $$
  select (now() at time zone 'UTC')::date
$$;

create function t.visitor(p_ip text, p_day date) returns bytea language sql as $$
  select substr(
    extensions.digest(
      txiki.salt_for(p_day) || convert_to(p_ip || 'Chrome' || 'Android' || 'mobile', 'UTF8'),
      'sha256'),
    1, 16)
$$;

create function t.ip_hash(p_ip text, p_day date) returns bytea language sql as $$
  select extensions.digest(txiki.salt_for(p_day) || convert_to(p_ip, 'UTF8'), 'sha256')
$$;

create function t.mk(p_ask boolean default false, p_ip text default '198.51.100.1')
returns table(code text, token text) language sql as $$
  select * from txiki.create_link('https://example.com/a', p_ask, p_ip)
$$;

create function t.click(p_code text, p_ip text default '203.0.113.7')
returns table(target text, ask_location boolean, location_token text) language sql as $$
  select * from txiki.record_click(
    p_code, p_ip, 'ES', 'Chrome', 'Android', 'mobile', 'es-ES', 'Europe/Madrid', 'T.co')
$$;

do $$
declare r record; v_hash bytea; v_stats jsonb;
begin
  perform t.reset();
  select * into r from t.mk();
  assert r.code ~ '^[0-9A-Za-z]{7}$', 'code is 7 base62 chars: ' || r.code;
  assert r.token ~ '^[A-Za-z0-9_-]{43}$', 'token is 43 base64url chars: ' || r.token;
  select token_hash into v_hash from txiki.links where code = r.code;
  assert v_hash = extensions.digest(
    decode(translate(r.token, '-_', '+/') || '=', 'base64'), 'sha256'),
    'token_hash is sha256 of the raw 32 bytes';
  assert not exists (select 1 from txiki.links where token_hash = convert_to(r.token, 'UTF8')),
    'the token itself is not stored';
  assert not exists (select 1 from txiki.create_log where ip_hash = convert_to('198.51.100.1', 'UTF8')),
    'the ip is not stored';
  assert (select ip_hash from txiki.create_log) = t.ip_hash('198.51.100.1', t.today()),
    'create_log holds sha256(salt || ip)';

  set role anon;
  v_stats := txiki.link_stats(r.code, r.token, 'UTC');
  assert v_stats is not null, 'good token returns stats';
  assert txiki.link_stats(r.code, repeat('A', 43), 'UTC') is null, 'wrong token returns null';
  assert txiki.link_stats(r.code, 'short', 'UTC') is null, 'malformed token returns null';
  assert txiki.link_stats(r.code, null, 'UTC') is null, 'null token returns null';
  assert txiki.link_stats('nope123', r.token, 'UTC') is null, 'unknown code returns null';
  reset role;
  assert v_stats->>'target' = 'https://example.com/a', 'target in stats';
  assert (v_stats->>'total')::int = 0 and (v_stats->>'uniques')::int = 0, 'empty counts';
  assert jsonb_array_length(v_stats->'by_hour') = 24, 'by_hour has 24 slots';
  assert v_stats->'countries' = '[]'::jsonb, 'empty list is []';
  raise notice 'PASS: create and stats';
end $$;

do $$
declare v text; bad text[] := array[
    'JaVaScript:x', 'data:x', 'ftp://x', ' https://x', 'https://x/' || chr(9) || 'y',
    'https://x/ y', 'https://x/' || chr(10), 'https://x/' || chr(127),
    'https://endika.github.io/txiki/#abc', 'https://Endika.GitHub.io/txiki',
    'https://user@endika.github.io:443/txiki/x', 'https://', 'http:///x', '',
    'https://x/' || repeat('a', 2039),
    'https://endika.github.io\txiki/#abc',
    'https://endika.github.io/./txiki/#abc',
    'https://endika.github.io/a/../txiki/#abc',
    'https://endika%2Egithub.io/txiki/#abc',
    'https://ｅｎｄｉｋａ.github.io/txiki/#abc',
    'https://endika.github.io//txiki/#abc',
    'https://endika.github.io/%74xiki/#abc',
    'https://endika.github.io./txiki/#abc',
    'https://ENDIKA.github.io:443/Txiki',
    'https://endika.github.io/a/.',
    'https://endika.github.io/a/..',
    'https://endika.github.io/a%2Fb',
    'https://x/'||chr(160),
    'https://x/'||U&'\200B',
    'https://x/'||U&'\FEFF',
    'https://x/'||U&'\202E',
    'https://ñandú.es/',
    'https://@/x',
    'http://:80',
    'https://[zz]/x',
    'https://exa_mple.com/',
    'https://a\b.com/',
    'https://a%41.com/'];
begin
  perform t.reset();
  foreach v in array bad loop
    assert t.err(format('select * from txiki.create_link(%L, false, %L)', v, '198.51.100.1'))
      = 'invalid target', 'rejected: ' || left(v, 40);
  end loop;
  assert t.err('select * from txiki.create_link(null, false, ''198.51.100.1'')') = 'invalid target',
    'null target rejected';
  assert t.err('select * from txiki.create_link(''https://x.es'', false, null)') = 'invalid ip', 'null ip rejected';
  assert (select count(*) from txiki.links) = 0, 'nothing stored for rejected targets';
  assert (select count(*) from txiki.create_log) = 0, 'rejected targets do not count for the rate limit';

  assert t.err(format('select * from txiki.create_link(%L, false, %L)',
    'https://x/' || repeat('a', 2038), '198.51.100.1') ) is null, '2048 chars is fine';
  assert t.err('select * from txiki.create_link(''HTTPS://Example.com'', false, ''198.51.100.1'')') is null,
    'uppercase scheme is fine';
  assert t.err('select * from txiki.create_link(''https://endika.github.io/other'', false, ''198.51.100.1'')') is null,
    'other paths on endika.github.io are fine';
  assert t.err('select * from txiki.create_link(''https://endika.github.io/other-project/'', false, ''198.51.100.1'')') is null,
    'other projects on endika.github.io are fine';
  assert t.err('select * from txiki.create_link(''https://[2001:db8::1]:8080/x'', false, ''198.51.100.1'')') is null,
    'bracketed ipv6 host is fine';
  assert t.err('select * from txiki.create_link(''https://endika.github.io'', false, ''198.51.100.1'')') is null,
    'endika.github.io root is fine';
  raise notice 'PASS: invalid targets';
end $$;

do $$
declare r record; v_target text := 'https://xn--and-6ma2c.es/a?b=1#c';
begin
  perform t.reset();
  select * into r from txiki.create_link(v_target, false, '198.51.100.1');
  assert (select target from txiki.links where code = r.code) = v_target, 'target stored byte for byte';
  assert (select target from t.click(r.code)) = v_target, 'redirect target is byte for byte';
  raise notice 'PASS: idn target round trip';
end $$;

do $$
declare i int; r record;
begin
  perform t.reset();
  for i in 1..10 loop
    perform t.mk(false, '198.51.100.1');
  end loop;
  assert t.err('select * from txiki.create_link(''https://x.es'', false, ''198.51.100.1'')') = 'rate limited',
    '11th from the same ip in an hour is rate limited';
  assert t.err('select * from txiki.create_link(''https://x.es'', false, ''198.51.100.2'')') is null,
    'another ip is fine';

  update txiki.create_log set at = now() - interval '61 minutes';
  assert t.err('select * from txiki.create_link(''https://x.es'', false, ''198.51.100.1'')') is null,
    'entries older than an hour do not count';

  perform t.reset();
  insert into txiki.create_log (ip_hash, at)
  select t.ip_hash('198.51.100.1', t.today() - 1), now() - interval '30 minutes'
  from generate_series(1, 10);
  assert t.err('select * from txiki.create_link(''https://x.es'', false, ''198.51.100.1'')') = 'rate limited',
    'entries hashed with yesterday''s salt still count';
  raise notice 'PASS: rate limit';
end $$;

do $$
begin
  perform t.reset();
  insert into txiki.links (code, target, token_hash)
  select lpad(i::text, 7, '0'), 'https://x.es', '\x00'::bytea from generate_series(1, 500) i;
  assert t.err('select * from txiki.create_link(''https://x.es'', false, ''198.51.100.1'')') = 'capacity reached',
    '500 links in 24 h is the cap';
  update txiki.links set created_at = now() - interval '25 hours' where code = lpad('1', 7, '0');
  assert t.err('select * from txiki.create_link(''https://x.es'', false, ''198.51.100.1'')') is null,
    'room again once one is older than 24 h';
  raise notice 'PASS: capacity';
end $$;

do $$
declare r record;
begin
  perform t.reset();
  select * into r from t.mk();
  update txiki.links set disabled = true where code = r.code;
  assert not exists (select 1 from t.click(r.code)), 'disabled link returns no rows';
  assert not exists (select 1 from t.click('Zz9Zz9Z')), 'unknown link returns no rows';
  assert not exists (select 1 from t.click('../../x')), 'malformed code returns no rows';
  assert (select count(*) from txiki.clicks) = 0, 'nothing recorded';
  raise notice 'PASS: record_click on missing links';
end $$;

do $$
declare r record; v_stats jsonb; v_row record;
begin
  perform t.reset();
  select * into r from t.mk();
  perform t.click(r.code);
  perform t.click(r.code);
  v_stats := txiki.link_stats(r.code, r.token, 'UTC');
  assert (v_stats->>'total')::int = 2 and (v_stats->>'uniques')::int = 1,
    'same ip and ua twice today: 2 clicks, 1 unique';
  assert (select visitor from txiki.clicks limit 1) = t.visitor('203.0.113.7', t.today()),
    'visitor is the first 16 bytes of sha256(salt || ip || browser || os || device)';
  assert not exists (select 1 from txiki.clicks where visitor = convert_to('203.0.113.7', 'UTF8')),
    'ip is not stored in clicks';
  assert (select last_click_at from txiki.links where code = r.code) is not null, 'last_click_at is set';

  update txiki.clicks set at = at - interval '1 day', visitor = t.visitor('203.0.113.7', t.today() - 1)
  where id = (select min(id) from txiki.clicks);
  v_stats := txiki.link_stats(r.code, r.token, 'UTC');
  assert (v_stats->>'total')::int = 2 and (v_stats->>'uniques')::int = 2,
    'same visitor on two days counts twice';
  raise notice 'PASS: uniques';
end $$;

do $$
declare r record; v_stats jsonb;
begin
  perform t.reset();
  select * into r from t.mk();
  insert into txiki.clicks (code, at, browser, os, device, visitor)
  values (r.code, '2026-07-01 22:30:00+00', 'Chrome', 'Android', 'mobile', '\x01');
  v_stats := txiki.link_stats(r.code, r.token, 'Europe/Madrid');
  assert (v_stats->'by_hour'->>0)::int = 1, 'Madrid: 22:30 UTC is hour 0';
  assert v_stats->'by_day'->0->>'day' = '2026-07-02', 'Madrid: the day is the 2nd';
  v_stats := txiki.link_stats(r.code, r.token, 'Nope/Nope');
  assert (v_stats->'by_hour'->>22)::int = 1, 'invalid tz falls back to UTC: hour 22';
  assert v_stats->'by_day'->0->>'day' = '2026-07-01', 'invalid tz: UTC day';
  v_stats := txiki.link_stats(r.code, r.token, null);
  assert (v_stats->'by_hour'->>22)::int = 1, 'null tz falls back to UTC';

  delete from txiki.clicks;
  insert into txiki.clicks (code, at, browser, os, device, visitor)
  select r.code, ts, 'Chrome', 'Android', 'mobile', '\x01'
  from unnest(array[
    '2026-03-29 00:30:00+00', '2026-03-29 01:30:00+00', '2026-03-29 02:30:00+00',
    '2026-10-25 00:30:00+00', '2026-10-25 01:30:00+00', '2026-10-25 02:30:00+00']::timestamptz[]) ts;
  v_stats := txiki.link_stats(r.code, r.token, 'Europe/Madrid');
  assert (select sum(v::int) from jsonb_array_elements_text(v_stats->'by_hour') v) = 6,
    'by_hour keeps every click across both DST changes';
  assert (select sum((e->>'count')::int) from jsonb_array_elements(v_stats->'by_day') e) = 6,
    'by_day keeps every click across both DST changes';
  raise notice 'PASS: time zones';
end $$;

do $$
declare r record; c record; v_stats jsonb; i int;
begin
  perform t.reset();
  select * into r from t.mk();
  for i in 1..3 loop perform t.click(r.code, '203.0.113.' || i); end loop;
  insert into txiki.clicks (code, browser, os, device, visitor, country, referrer_host, lang)
  values (r.code, 'Safari', 'iOS', 'mobile', '\x02', null, null, null);
  v_stats := txiki.link_stats(r.code, r.token, 'UTC');
  assert v_stats->'browsers'->0 = '{"key": "Chrome", "count": 3}'::jsonb, 'browsers sorted desc';
  assert v_stats->'countries'->1 = '{"key": null, "count": 1}'::jsonb, 'null keys come out as null';
  assert v_stats->'referrers'->0 = '{"key": "T.co", "count": 3}'::jsonb, 'referrers';
  assert jsonb_array_length(v_stats->'recent') = 4, 'recent lists the clicks';
  assert (select array_agg(k order by k) from jsonb_object_keys(v_stats->'recent'->0) k)
    = array['at', 'browser', 'country', 'device', 'os', 'referrer_host'], 'recent has exactly these keys';

  insert into txiki.clicks (code, browser, os, device, visitor)
  select r.code, 'Chrome', 'Linux', 'desktop', '\x03' from generate_series(1, 60);
  v_stats := txiki.link_stats(r.code, r.token, 'UTC');
  assert jsonb_array_length(v_stats->'recent') = 50, 'recent is capped at 50';
  assert (v_stats->>'total')::int = 64, 'the cap does not touch the totals';

  insert into txiki.clicks (code, browser, os, device, visitor, lat, lon)
  select r.code, 'Chrome', 'Linux', 'desktop', '\x03', 40.42, -3.70 from generate_series(1, 510);
  v_stats := txiki.link_stats(r.code, r.token, 'UTC');
  assert jsonb_array_length(v_stats->'points') = 500, 'points are capped at 500';
  perform t.reset();
  select * into r from t.mk();
  insert into txiki.clicks (code, browser, os, device, visitor, lang)
  select r.code, 'Chrome', 'Linux', 'desktop', '\x03', 'l' || lpad(g::text, 2, '0')
  from generate_series(1, 60) g;
  v_stats := txiki.link_stats(r.code, r.token, 'UTC');
  assert jsonb_array_length(v_stats->'langs') = 51, 'langs capped at 50 plus the remainder';
  assert v_stats->'langs'->50 = '{"key": "__other__", "count": 10}'::jsonb, 'remainder is folded into __other__';
  assert v_stats->'langs'->0->>'key' = 'l01', 'ties sort by key';
  insert into txiki.clicks (code, browser, os, device, visitor, lang)
  select r.code, 'Chrome', 'Linux', 'desktop', '\x03', 'l01' from generate_series(1, 3);
  v_stats := txiki.link_stats(r.code, r.token, 'UTC');
  assert v_stats->'langs'->0 = '{"key": "l01", "count": 4}'::jsonb, 'top entries sort by count desc';
  assert jsonb_array_length(v_stats->'browsers') = 1 and not (v_stats->'browsers' @> '[{"key": "__other__"}]'),
    'no __other__ without a remainder';
  raise notice 'PASS: stats shape';
end $$;

do $$
declare r record; c record; v_tok text; v_lat numeric; v_lon numeric;
begin
  perform t.reset();
  select * into r from t.mk(true);
  select * into c from t.click(r.code);
  assert c.ask_location and c.location_token ~ '^[A-Za-z0-9_-]{43}$', 'location token issued';
  assert (select location_expires_at from txiki.clicks) between now() + interval '9 minutes' and now() + interval '10 minutes 5 seconds',
    'window is 10 minutes';
  assert (select location_token_hash from txiki.clicks) is distinct from convert_to(c.location_token, 'UTF8'),
    'location token is stored hashed';

  set role anon;
  assert txiki.add_location(c.location_token, 40.41678, -3.70123), 'first use works';
  assert not txiki.add_location(c.location_token, 40.41678, -3.70123), 'second use is false';
  reset role;
  select lat, lon into v_lat, v_lon from txiki.clicks;
  assert v_lat = 40.42 and v_lon = -3.70, 'two decimals: ' || v_lat || ',' || v_lon;
  assert (select location_token_hash from txiki.clicks) is null, 'token hash is cleared';

  delete from txiki.clicks;
  select * into c from t.click(r.code);
  update txiki.clicks set location_expires_at = now() - interval '1 second';
  assert not txiki.add_location(c.location_token, 40, -3), 'expired token is false';

  delete from txiki.clicks;
  select * into c from t.click(r.code);
  assert not txiki.add_location(c.location_token, 91, 0), 'lat 91 is false';
  assert not txiki.add_location(c.location_token, -91, 0), 'lat -91 is false';
  assert not txiki.add_location(c.location_token, 0, 181), 'lon 181 is false';
  assert not txiki.add_location(c.location_token, 'NaN', 0), 'NaN is false';
  assert not txiki.add_location(c.location_token, null, 0), 'null is false';
  assert not txiki.add_location(repeat('A', 43), 40, -3), 'unknown token is false';
  assert not txiki.add_location('short', 40, -3), 'malformed token is false';
  assert not txiki.add_location(null, 40, -3), 'null token is false';
  assert (select lat from txiki.clicks) is null, 'nothing was stored by the failed calls';

  select * into r from t.mk(false);
  select * into c from t.click(r.code);
  assert c.location_token is null and not c.ask_location, 'no token when the link did not ask';
  raise notice 'PASS: add_location';
end $$;

do $$
declare r record; v_stats jsonb;
begin
  perform t.reset();
  select * into r from t.mk(true);
  perform t.click(r.code);
  update txiki.clicks set lat = 40.42, lon = -3.70;
  v_stats := txiki.link_stats(r.code, r.token, 'UTC');
  assert v_stats->'points'->0 ->> 'lat' = '40.42', 'points carry lat';
  raise notice 'PASS: points';
end $$;

do $$
declare r record;
begin
  perform t.reset();
  select * into r from t.mk();
  perform t.click(r.code);
  set role anon;
  assert not txiki.delete_link(r.code, repeat('A', 43)), 'wrong token does not delete';
  assert not txiki.delete_link(r.code, 'short'), 'malformed token does not delete';
  assert not txiki.delete_link(r.code, null), 'null token does not delete';
  assert not txiki.delete_link('nope123', r.token), 'unknown code is false';
  reset role;
  assert (select count(*) from txiki.links) = 1 and (select count(*) from txiki.clicks) = 1,
    'nothing was deleted';
  set role anon;
  assert txiki.delete_link(r.code, r.token), 'good token deletes';
  reset role;
  assert (select count(*) from txiki.links) = 0 and (select count(*) from txiki.clicks) = 0,
    'link and clicks are gone';
  raise notice 'PASS: delete_link';
end $$;

do $$
declare r record; v_old record; v_idle record; v_kept record;
begin
  perform t.reset();
  select * into v_kept from t.mk();
  select * into v_old from t.mk();
  select * into v_idle from t.mk();

  insert into txiki.clicks (code, at, browser, os, device, visitor) values
    (v_kept.code, now() - interval '13 months', 'Chrome', 'Android', 'mobile', '\x01'),
    (v_kept.code, now() - interval '11 months', 'Chrome', 'Android', 'mobile', '\x01');
  update txiki.links set last_click_at = now() - interval '11 months' where code = v_kept.code;
  update txiki.links set last_click_at = now() - interval '13 months' where code = v_old.code;
  update txiki.links set created_at = now() - interval '13 months' where code = v_idle.code;

  insert into txiki.create_log (ip_hash, at) values ('\x01', now() - interval '3 days'), ('\x02', now());
  perform txiki.salt_for(t.today() - 3);
  perform txiki.salt_for(t.today() - 1);
  perform txiki.salt_for(t.today());

  assert (select schedule from cron.job where jobname = 'txiki-retention') = '30 3 * * *', 'schedule';
  execute (select command from cron.job where jobname = 'txiki-retention');

  assert (select count(*) from txiki.clicks) = 1, 'the 13-month-old click is gone, the 11-month one stays';
  assert exists (select 1 from txiki.links where code = v_kept.code), 'active link stays';
  assert not exists (select 1 from txiki.links where code = v_old.code), 'link idle for 13 months goes';
  assert not exists (select 1 from txiki.links where code = v_idle.code), 'never-clicked link older than 12 months goes';
  assert not exists (select 1 from txiki.create_log where ip_hash = '\x01'), 'create_log older than 2 days goes';
  assert exists (select 1 from txiki.create_log where ip_hash = '\x02'), 'recent create_log stays';
  assert (select count(*) from txiki.salts) >= 2
    and not exists (select 1 from txiki.salts where day < t.today() - 1), 'salts older than yesterday go';
  assert exists (select 1 from txiki.salts where day = t.today() - 1), 'yesterday''s salt stays';
  raise notice 'PASS: retention';
end $$;

do $$
declare tbl text; priv text; rl text;
begin
  foreach rl in array array['anon', 'authenticated', 'service_role'] loop
    foreach tbl in array array['txiki.links', 'txiki.clicks', 'txiki.create_log', 'txiki.salts'] loop
      foreach priv in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
        assert not has_table_privilege(rl, tbl, priv), format('%s must not have %s on %s', rl, priv, tbl);
      end loop;
    end loop;
  end loop;

  assert (select array_agg(p.proname::text order by p.proname) from pg_proc p
          where p.pronamespace = 'txiki'::regnamespace and has_function_privilege('anon', p.oid, 'execute'))
    = array['add_location', 'delete_link', 'link_stats'], 'anon runs exactly three functions';
  assert (select count(*) from pg_proc p
          where p.pronamespace = 'txiki'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')) = 0,
    'authenticated runs nothing';
  assert (select array_agg(p.proname::text order by p.proname) from pg_proc p
          where p.pronamespace = 'txiki'::regnamespace and has_function_privilege('service_role', p.oid, 'execute'))
    = array['create_link', 'record_click'], 'service_role runs exactly two functions';
  assert not has_function_privilege('anon', 'txiki.create_link(text,bool,text)', 'execute'), 'anon create_link';
  assert not has_function_privilege('anon',
    'txiki.record_click(text,text,text,text,text,text,text,text,text)', 'execute'), 'anon record_click';
  assert not has_function_privilege('anon', 'txiki.salt_for(date)', 'execute'), 'anon salt_for';
  assert not has_function_privilege('authenticated', 'txiki.create_link(text,bool,text)', 'execute'),
    'authenticated create_link';
  assert has_function_privilege('service_role', 'txiki.create_link(text,bool,text)', 'execute'), 'service create_link';
  assert has_function_privilege('service_role',
    'txiki.record_click(text,text,text,text,text,text,text,text,text)', 'execute'), 'service record_click';
  assert not has_function_privilege('service_role', 'txiki.link_stats(text,text,text)', 'execute'), 'service link_stats';
  assert has_function_privilege('anon', 'txiki.link_stats(text,text,text)', 'execute'), 'anon link_stats';
  assert has_function_privilege('anon', 'txiki.delete_link(text,text)', 'execute'), 'anon delete_link';
  assert has_function_privilege('anon', 'txiki.add_location(text,float8,float8)', 'execute'), 'anon add_location';
  assert not has_function_privilege('authenticated', 'txiki.link_stats(text,text,text)', 'execute'),
    'authenticated link_stats';
  assert has_schema_privilege('anon', 'txiki', 'usage') and has_schema_privilege('service_role', 'txiki', 'usage'),
    'schema usage';
  assert not has_schema_privilege('authenticated', 'txiki', 'usage'), 'authenticated has no schema usage';
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'txiki' and not p.prosecdef), 'every function is security definer';
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'txiki' and not coalesce(p.proconfig, '{}') @> array['search_path=""']),
    'every function pins search_path';
  raise notice 'PASS: privileges';
end $$;

do $$
declare r record; v text;
begin
  perform t.reset();
  set role anon;
  v := t.err('select * from txiki.create_link(''https://x.es'', false, ''1.1.1.1'')');
  assert v like 'permission denied%', 'anon cannot call create_link: ' || v;
  v := t.err('select * from txiki.links');
  assert v like 'permission denied%', 'anon cannot read links: ' || v;
  reset role;
  set role service_role;
  select * into r from txiki.create_link('https://x.es', false, '1.1.1.1');
  assert r.code is not null, 'service_role can create';
  assert exists (select 1 from txiki.record_click(r.code, '1.1.1.1', null, 'Other', 'Other', 'desktop', null, null, null)),
    'service_role can record a click';
  v := t.err('select * from txiki.link_stats(''abcdefg'', ''x'', ''UTC'')');
  assert v like 'permission denied%', 'service_role cannot call link_stats';
  reset role;
  raise notice 'PASS: calls as roles';
end $$;

do $$
declare r record; c record;
begin
  perform t.reset();
  select * into r from t.mk();
  select * into c from txiki.record_click(r.code, '1.1.1.1', null, 'Other', 'Other', 'desktop',
    repeat('l', 100), repeat('z', 100), repeat('h', 300));
  assert (select length(lang) from txiki.clicks) = 35, 'lang cut to 35';
  assert (select length(tz) from txiki.clicks) = 64, 'tz cut to 64';
  assert (select length(referrer_host) from txiki.clicks) = 253, 'referrer_host cut to 253';
  assert (select country from txiki.clicks) is null, 'null country stays null';
  delete from txiki.clicks;
  perform txiki.record_click(r.code, '1.1.1.1', 'xx', 'Other', 'Other', 'desktop', null, null, null);
  assert (select country from txiki.clicks) is null, 'invalid country is stored as null';
  raise notice 'PASS: truncation';
end $$;

select t.reset();
