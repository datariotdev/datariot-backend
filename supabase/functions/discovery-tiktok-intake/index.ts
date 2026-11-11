import { createClient } from "npm:@supabase/supabase-js@2";

const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const allowed = (url: URL) => ["www.tiktok.com", "tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"].includes(url.hostname);
Deno.serve(async (request) => {
  if (request.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  const auth = request.headers.get("authorization") || "";
  const apiUrl = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiUrl || !anon || !service) return respond({ error: "not_configured" }, 503);
  if (!auth.startsWith("Bearer ")) return respond({ error: "unauthorized" }, 401);
  const identity = createClient(apiUrl, anon, { auth: { persistSession: false } });
  const { data: { user }, error } = await identity.auth.getUser(auth.slice(7));
  if (error || !user) return respond({ error: "unauthorized" }, 401);
  if (user.app_metadata?.role !== "admin" && user.app_metadata?.discovery_admin !== true) return respond({ error: "forbidden" }, 403);
  let body: any;
  try { body = await request.json(); } catch { return respond({ error: "invalid_json" }, 400); }
  if (!Array.isArray(body?.candidates) || body.candidates.length > 30) return respond({ error: "expected_1_to_30_candidates" }, 400);
  const rows = [];
  for (const item of body.candidates) {
    if (typeof item?.url !== "string" || typeof item?.title !== "string" || item.title.length > 240) return respond({ error: "invalid_candidate" }, 400);
    let url: URL;
    try { url = new URL(item.url); } catch { return respond({ error: "invalid_url" }, 400); }
    if (url.protocol !== "https:" || !allowed(url)) return respond({ error: "tiktok_https_url_required" }, 400);
    const canonical = url.origin + url.pathname.replace(/\/$/, "");
    const match = url.pathname.match(/\/video\/(\d+)/);
    const sourceId = match?.[1] || canonical;
    rows.push({ source: "tiktok", source_video_id: sourceId, source_url: canonical, title: item.title.trim(), language: item.language === "en" ? "en" : null, duration_seconds: Number.isInteger(item.duration_seconds) && item.duration_seconds > 0 ? item.duration_seconds : null, status: "discovered", rights_verified: false });
  }
  if (!rows.length) return respond({ inserted: 0 });
  const db = createClient(apiUrl, service, { auth: { persistSession: false } });
  const { data, error: dbError } = await db.from("discovery_candidates").upsert(rows, { onConflict: "source,source_video_id", ignoreDuplicates: true }).select("id");
  if (dbError) return respond({ error: "insert_failed" }, 500);
  return respond({ inserted: data?.length || 0, state: "discovered", note: "No video downloaded or published. Manual review and verified rights required." }, 201);
});
