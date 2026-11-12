import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    return json({ error: "server_not_configured" }, 503);
  }
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data: { user }, error } = await client.auth.getUser(auth.slice(7));
  if (error || !user) return json({ error: "unauthorized" }, 401);
  if (
    user.app_metadata?.role !== "admin" &&
    user.app_metadata?.discovery_admin !== true
  ) return json({ error: "forbidden" }, 403);
  const status = new URL(req.url).searchParams.get("status") ??
    "pending_review";
  if (!["discovered", "analyzed", "pending_review"].includes(status)) {
    return json({ error: "invalid_status" }, 400);
  }
  const db = createClient(url, service, { auth: { persistSession: false } });
  const queue = db.from("discovery_candidates")
    .select(
      "id,source,source_url,title,language,duration_seconds,quality_score,ai_explanation,license_type,license_evidence_url,rights_verified,status,thumbnail_url,created_at,first_reference_at,recommendation_count,recommendation_evidence",
    )
    .eq("status", status);
  if (status !== "pending_review") {
    queue.order("recommendation_count", { ascending: false });
  }
  const { data, error: queryError } = await queue
    .order("created_at", { ascending: true }).limit(100);
  if (queryError) return json({ error: "query_failed" }, 500);
  return json({
    candidates: data,
    minimum_quality_score: 80,
    daily_target: 30,
    mode: "manual",
    publication_enabled: false,
  });
});
