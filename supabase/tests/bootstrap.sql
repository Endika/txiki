\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

create schema extensions;
create extension pgcrypto schema extensions;

create schema cron;
create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(p_jobname text, p_schedule text, p_command text)
returns bigint
language sql
as $$
  insert into cron.job values (p_jobname, p_schedule, p_command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command;
  select 1::bigint;
$$;
