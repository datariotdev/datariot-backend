create or replace function public.record_discovery_hn_candidates(p_candidates jsonb)
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
    select coalesce(source, 'tiktok'), source_video_id, source_url, title,
           first_reference_at, recommendation_count, recommendation_evidence
    from jsonb_to_recordset(p_candidates) as candidate (
      source text,
      source_video_id text,
      source_url text,
      title text,
      first_reference_at timestamptz,
      recommendation_count integer,
      recommendation_evidence jsonb
    )
    where source is null or source in ('tiktok', 'youtube_shorts')
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
