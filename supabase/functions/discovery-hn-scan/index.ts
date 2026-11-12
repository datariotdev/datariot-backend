import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import {
  findCandidates,
  searchHackerNews,
  type VideoSource,
} from "./recommendations.ts";

const source = "hacker_news_tiktok";
const videoSources: VideoSource[] = ["youtube_shorts", "tiktok"];
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return reply({ error: "method_not_allowed" }, 405);
  }

  // A fresh queue ID authorizes one run. It is minted by Postgres and claimed atomically.
  const jobId = request.headers.get("x-discovery-job");
  if (!jobId || !uuid.test(jobId)) return reply({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return reply({ error: "not_configured" }, 503);

  const db = createClient(url, service, { auth: { persistSession: false } });
  const now = Date.now();
  const { data: job, error: claimError } = await db.from("discovery_jobs")
    .update({ status: "running" })
    .eq("id", jobId).eq("source", source).eq("status", "queued")
    .gt("started_at", new Date(now - 10 * 60_000).toISOString())
    .select("id").maybeSingle();
  if (claimError) return reply({ error: "claim_failed" }, 500);
  if (!job) return reply({ error: "unauthorized" }, 401);

  try {
    const searches = await Promise.allSettled(
      videoSources.map((videoSource) => searchHackerNews(now, videoSource)),
    );
    const unavailable = videoSources.filter((_, index) =>
      searches[index].status === "rejected"
    );
    const available = searches.flatMap((search) =>
      search.status === "fulfilled" ? search.value : []
    );
    if (unavailable.length === videoSources.length) {
      throw new Error("all_sources_unavailable");
    }

    const candidates = findCandidates(available, now)
      .filter((candidate) => !unavailable.includes(candidate.source));
    const { data: saved, error: saveError } = await db.rpc(
      "record_discovery_hn_candidates",
      { p_candidates: candidates },
    );
    if (saveError) {
      console.error("Could not store Discovery candidates", saveError.code);
      throw new Error("candidate_write_failed");
    }

    const { error: finishError } = await db.from("discovery_jobs").update({
      status: unavailable.length ? "partial" : "completed",
      error_message: unavailable.length
        ? `Unavailable: ${unavailable.join(", ")}`
        : null,
      discovered_count: candidates.length,
      finished_at: new Date().toISOString(),
    }).eq("id", jobId).eq("status", "running");
    if (finishError) throw new Error("job_update_failed");

    return reply({
      scanned_comments: new Set(available.map((comment) =>
        comment.objectID
      )).size,
      candidates: candidates.length,
      youtube_shorts: candidates.filter((candidate) =>
        candidate.source === "youtube_shorts"
      ).length,
      unavailable,
      saved,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "scan_failed";
    const { error: logError } = await db.from("discovery_jobs").update({
      status: "failed",
      error_message: reason.slice(0, 200),
      finished_at: new Date().toISOString(),
    }).eq("id", jobId).eq("status", "running");
    if (logError) {
      console.error("Could not record Discovery scan failure", logError.code);
    }
    return reply({ error: "scan_failed" }, 502);
  }
});
