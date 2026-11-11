import { createClient } from "npm:@supabase/supabase-js@2.95.0";
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
Deno.serve(async req=>{
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
 const jwt=req.headers.get("authorization")?.replace(/^Bearer /,"");
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),gemini=Deno.env.get("GEMINI_API_KEY");
 if(!jwt)return reply({error:"unauthorized"},401);
 if(!url||!anon||!service||!gemini)return reply({error:"not_configured"},503);
 const auth=createClient(url,anon,{auth:{persistSession:false}});
 const {data:{user},error:authError}=await auth.auth.getUser(jwt);
 if(authError||!user)return reply({error:"unauthorized"},401);
 if(user.app_metadata?.role!=="admin"&&user.app_metadata?.discovery_admin!==true)return reply({error:"forbidden"},403);
 let input:any;try{input=await req.json()}catch{return reply({error:"invalid_json"},400)}
 if(typeof input?.id!=="string"||!/^[0-9a-f-]{36}$/i.test(input.id)||typeof input?.transcript!=="string"||input.transcript.trim().length<80||input.transcript.length>16000)return reply({error:"id_and_transcript_required"},400);
 const db=createClient(url,service,{auth:{persistSession:false}});
 const {data:video}=await db.from("discovery_candidates").select("id,title,status").eq("id",input.id).eq("source","tiktok").single();
 if(!video||!["discovered","analyzed"].includes(video.status))return reply({error:"candidate_not_eligible"},409);
 const prompt=`Evaluate an English educational short-form video based ONLY on the supplied transcript. Do not claim to have watched the video. Score 0-100 using educational value (30), clarity (25), originality (15), evidence and factual care (20), audience relevance (10). If transcript is not English, language must be "other". Return JSON only with integer score, language ("en" or "other"), explanation (max 400 chars), fact_check_needed boolean. Do not assert rights or permission. Title: ${video.title}\nTranscript:\n${input.transcript}`;
 let response:Response;
 try{response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",{method:"POST",headers:{"content-type":"application/json","x-goog-api-key":gemini},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json",temperature:0.1}}),signal:AbortSignal.timeout(20000)})}catch{return reply({error:"provider_unavailable"},502)}
 if(!response.ok)return reply({error:"provider_error"},502);
 let evaluation:any;
 try{const raw=await response.json();evaluation=JSON.parse(raw.candidates[0].content.parts.map((x:any)=>x.text||"").join(""))}catch{return reply({error:"invalid_model_output"},502)}
 if(!Number.isInteger(evaluation.score)||evaluation.score<0||evaluation.score>100||!["en","other"].includes(evaluation.language)||typeof evaluation.explanation!=="string"||typeof evaluation.fact_check_needed!=="boolean")return reply({error:"invalid_model_score"},502);
 const qualifies=evaluation.score>=80&&evaluation.language==="en";
 const {data,error}=await db.from("discovery_candidates").update({quality_score:evaluation.score,language:evaluation.language==="en"?"en":null,ai_explanation:evaluation.explanation.slice(0,400)+(evaluation.fact_check_needed?" [Fact-check required]":""),status:qualifies?"analyzed":"rejected",updated_at:new Date().toISOString()}).eq("id",input.id).in("status",["discovered","analyzed"]).select("id,status,quality_score").maybeSingle();
 if(error||!data)return reply({error:"update_failed"},409);
 return reply({candidate:data,fact_check_needed:evaluation.fact_check_needed,rights_verified:false,published:false});
});
