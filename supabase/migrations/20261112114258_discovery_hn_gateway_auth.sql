create or replace function public.queue_discovery_hn_scan(p_project_url text)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job_id uuid;
  gateway_jwt text;
begin
  perform pg_advisory_xact_lock(690431957104671218);
  update public.discovery_jobs
  set status = 'failed', error_message = 'job_timeout', finished_at = now()
  where source = 'hacker_news_tiktok'
    and status in ('queued', 'running')
    and started_at <= now() - interval '10 minutes';

  if exists (
    select 1 from public.discovery_jobs
    where source = 'hacker_news_tiktok' and status in ('queued', 'running')
  ) then
    return null;
  end if;

  if p_project_url is null or p_project_url !~ '^https://[a-z0-9]+\.supabase\.co$' then
    raise exception 'Expected a Supabase project origin';
  end if;

  select decrypted_secret into gateway_jwt
  from vault.decrypted_secrets
  where name = 'datariot_discovery_anon_jwt';

  if gateway_jwt is null then
    raise exception 'Discovery gateway JWT is missing from Vault';
  end if;

  insert into public.discovery_jobs (source, status)
  values ('hacker_news_tiktok', 'queued')
  returning id into job_id;

  return net.http_post(
    url := p_project_url || '/functions/v1/discovery-hn-scan',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || gateway_jwt,
      'x-discovery-job', job_id
    ),
    timeout_milliseconds := 90000
  );
end;
$$;

revoke all on function public.queue_discovery_hn_scan(text) from public, anon, authenticated, service_role;
