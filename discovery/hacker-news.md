# Discovery from Hacker News

The scan searches Hacker News comments for canonical TikTok video links. The first
dated reference must be at least 180 days old. English phrases near a link are
used as recommendation signals, and one Hacker News account counts once per
video. A moderator can open a source comment at
`https://news.ycombinator.com/item?id=<comment_id>`. A recommendation is a
reason to check a video; it does not verify language, quality, or rights.

The scan writes candidates to the existing `discovered` state. For an
administrator, `GET /functions/v1/discovery-review-queue?status=discovered`
lists candidates by recommendation count. The same endpoint accepts
`status=analyzed` and defaults to `pending_review`. Use the existing
`discovery-tiktok-score` endpoint with a supplied transcript, then follow the
existing rights, review and publication workflow.

## Deployment and operation

1. Apply the `discovery_hn_recommendations` migration on a project with the
   existing Discovery tables and `pg_net`.
2. Apply the `discovery_hn_gateway_auth` migration. Store the project's legacy
   **anon** JWT in Vault as `datariot_discovery_anon_jwt`. Deploy both Edge
   Functions with gateway JWT verification enabled. The scan also requires
   a single-use ID from the private jobs table, issued by the database scheduler.
3. As the database owner, run `select public.queue_discovery_hn_scan('<project origin>');`
   and verify the resulting job is `completed` in `public.discovery_jobs`.
   The HTTP response is available in `net._http_response` using the returned request ID.
4. To run daily, enable `pg_cron` and schedule the same SQL call with
   `cron.schedule('datariot-discovery-hn', '0 6 * * *', '<SQL call>')`.
   The schedule can be stopped with `cron.unschedule('datariot-discovery-hn')`.

The scan uses Hacker News search data and does not fetch or upload media.
Shortened TikTok URLs, links without enough context, and other video providers
are outside this adapter's current coverage.
