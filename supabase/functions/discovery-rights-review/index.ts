import { createClient } from "npm:@supabase/supabase-js@2.95.0";
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
Deno.serve(async req=>{
 if(req.method!=="POST")return respond({error:"method_not_allowed"},405);
 const jwt=req.headers.get("authorization")?.replace(/^Bearer /,"");
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!jwt)return respond({error:"unauthorized"},401);
 if(!url||!anon||!service)return respond({error:"not_configured"},503);
 const auth=createClient(url,anon,{auth:{persistSession:false}});
 const {data:{user},error:authError}=await auth.auth.getUser(jwt);
 if(authError||!user)return respond({error:"unauthorized"},401);
 if(user.app_metadata?.role!=="admin"&&user.app_metadata?.discovery_admin!==true)return respond({error:"forbidden"},403);
 let body:any;try{body=await req.json()}catch{return respond({error:"invalid_json"},400)}
 if(typeof body?.id!=="string"||!/^[0-9a-f-]{36}$/i.test(body.id)||typeof body.license_type!=="string"||body.license_type.length>100||!["creator_permission","public_domain","cc_by","cc_by_sa"].includes(body.license_type))return respond({error:"invalid_license"},400);
 let evidence:URL;try{evidence=new URL(body.evidence_url)}catch{return respond({error:"evidence_url_required"},400)}
 if(evidence.protocol!=="https:")return respond({error:"https_evidence_required"},400);
 const db=createClient(url,service,{auth:{persistSession:false}});
 const {data:row,error}=await db.from("discovery_candidates").select("id,status,quality_score,language").eq("id",body.id).eq("status","analyzed").single();
 if(error||!row)return respond({error:"candidate_not_analyzed"},409);
 if(row.quality_score<80||row.language!=="en")return respond({error:"score_below_threshold"},422);
 // Human admin attests that evidence has been reviewed; this endpoint does not independently validate licensing.
 const {data,error:writeError}=await db.from("discovery_candidates").update({rights_verified:true,license_type:body.license_type,license_evidence_url:evidence.href,status:"pending_review",updated_at:new Date().toISOString()}).eq("id",body.id).eq("status","analyzed").select("id,status").maybeSingle();
 if(writeError||!data)return respond({error:"update_failed"},409);
 return respond({candidate:data,note:"Rights attested by admin; independent review remains required."});
});
