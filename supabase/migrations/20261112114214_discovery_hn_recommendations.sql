alter table public.discovery_candidates
  add column first_reference_at timestamptz,
  add column recommendation_count integer not null default 0 check (recommendation_count >= 0),
  add column recommendation_evidence jsonb not null default '[]'::jsonb;

create function public.record_discovery_hn_candidates(p_candidates jsonb)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with saved as (
    insert into public.discovery_candidates as existing (
      source, source_video_id, source_url, title,
      first_reference_at, recommendation_count, recommendation_evidence
    )
    select 'tiktok', source_video_id, source_url, title,
           first_reference_at, recommendation_count, recommendation_evidence
    from jsonb_to_recordset(p_candidates) as candidate (
      source_video_id text,
      source_url text,
      title text,
      first_reference_at timestamptz,
      recommendation_count integer,
      recommendation_evidence jsonb
    )
    on conflict (source, source_video_id) do update
      set first_reference_at = least(existing.first_reference_at, excluded.first_reference_at),
          recommendation_count = excluded.recommendation_count,
          recommendation_evidence = excluded.recommendation_evidence
      where (existing.first_reference_at, existing.recommendation_count, existing.recommendation_evidence)
        is distinct from (
          least(existing.first_reference_at, excluded.first_reference_at),
          excluded.recommendation_count, excluded.recommendation_evidence
        )
    returning 1
  )
  select count(*)::integer from saved;
$$;

revoke all on function public.record_discovery_hn_candidates(jsonb) from public, anon, authenticated;
grant execute on function public.record_discovery_hn_candidates(jsonb) to service_role;

create function public.queue_discovery_hn_scan(p_project_url text)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  job_id uuid;
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

  insert into public.discovery_jobs (source, status)
  values ('hacker_news_tiktok', 'queued')
  returning id into job_id;

  return net.http_post(
    url := p_project_url || '/functions/v1/discovery-hn-scan',
    headers := jsonb_build_object('content-type', 'application/json', 'x-discovery-job', job_id),
    timeout_milliseconds := 90000
  );
end;
$$;

revoke all on function public.queue_discovery_hn_scan(text) from public, anon, authenticated, service_role;
