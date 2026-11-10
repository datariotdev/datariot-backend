# Datariot Discovery Engine (implementation branch)

## Targets
- English educational short videos, 30 approved publications/day maximum.
- Orvelis AI quality score >= 80/100.
- Manual editorial review mandatory.
- Never download or republish third-party media without documented rights.
- Never insert candidates directly into public.videos.

## Production schema (already applied)
- public.discovery_candidates: deduplicated queue, rights flag, AI score, review metadata, status.
- public.discovery_jobs: job execution logs.
- public.video_provenance: rights audit trail for published videos.
- All three have RLS enabled and no anon/authenticated table grants.

## Existing production components to integrate
- public.external_video_candidates (62 rows at inspection): existing internal editorial queue.
- public.curated_reels (58 rows): existing official Instagram embed metadata.
- public.videos (2 rows): native video feed.
Avoid duplicating those pipelines. Audit existing consumers and RLS before changing anything.

## Next implementation gates
1. Inspect existing Edge Functions, feeds, editorial queue, storage and administrator auth.
2. Create authorized-source adapters; ingest metadata only.
3. Implement server-side Orvelis scoring, with fact-check flags and deduplication.
4. Verify license and evidence; do not infer permission from a public URL or Creative Commons label alone.
5. Build authenticated admin review UI; server checks admin authorization, not editable user_metadata.
6. Implement transactional publish after human approval, with media validation and provenance.
7. Add scheduler, rate limits, monitoring and kill switch. Run dry-run tests before enabling production jobs.

No production ingestion, scheduler or automatic publication is enabled by this branch.
