import { createClient } from "npm:@supabase/supabase-js@2.95.0";
const reply = (body: unknown, status=200) => new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
Deno.serve(async request => {
 if(request.method!=="POST") return reply({error:"method_not_allowed"},405);
 const token=request.headers.get("authorization")?.replace(/^Bearer /,"");
 if(!token) return reply({error:"unauthorized"},401);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!secret) return reply({error:"not_configured"},503);
 const auth=createClient(url,anon,{auth:{persistSession:false}});
 const {data:{user},error:authError}=await auth.auth.getUser(token);
 if(authError||!user) return reply({error:"unauthorized"},401);
 if(user.app_metadata?.role!=="admin"&&user.app_metadata?.discovery_admin!==true) return reply({error:"forbidden"},403);
 let input:any;try{input=await request.json()}catch{return reply({error:"invalid_json"},400)}
 if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(input?.id||"")||!["approve","reject"].includes(input?.decision))return reply({error:"invalid_input"},400);
 const db=createClient(url,secret,{auth:{persistSession:false}});
 const {data:candidate,error}=await db.from("discovery_candidates").select("id,status,quality_score,rights_verified,license_type,license_evidence_url,language").eq("id",input.id).single();
 if(error||!candidate)return reply({error:"not_found"},404);
 if(candidate.status!=="pending_review")return reply({error:"not_pending_review"},409);
 if(input.decision==="approve" && (candidate.quality_score===null||candidate.quality_score<80||candidate.language!=="en"||!candidate.rights_verified||!candidate.license_type||!candidate.license_evidence_url))return reply({error:"approval_requirements_not_met"},422);
 const next=input.decision==="approve"?"approved":"rejected";
 const {data:updated,error:updateError}=await db.from("discovery_candidates").update({status:next,reviewed_by:user.id,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",input.id).eq("status","pending_review").select("id,status").maybeSingle();
 if(updateError)return reply({error:"review_failed"},500);
 if(!updated)return reply({error:"concurrent_review"},409);
 return reply({candidate:updated,published:false});
});
