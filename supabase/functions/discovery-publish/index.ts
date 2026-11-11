import { createClient } from "npm:@supabase/supabase-js@2.95.0";
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
Deno.serve(async req=>{
 if(req.method!=="POST")return reply({error:"method_not_allowed"},405);
 const jwt=req.headers.get("authorization")?.replace(/^Bearer /,"");
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!jwt)return reply({error:"unauthorized"},401);
 if(!url||!anon||!secret)return reply({error:"not_configured"},503);
 const auth=createClient(url,anon,{auth:{persistSession:false}});
 const {data:{user},error:authError}=await auth.auth.getUser(jwt);
 if(authError||!user)return reply({error:"unauthorized"},401);
 if(user.app_metadata?.role!=="admin"&&user.app_metadata?.discovery_admin!==true)return reply({error:"forbidden"},403);
 const type=req.headers.get("content-type")||"";
 if(!type.includes("multipart/form-data"))return reply({error:"multipart_required"},415);
 const length=Number(req.headers.get("content-length")||0);
 if(length>35_000_000)return reply({error:"file_too_large"},413);
 let form:FormData;try{form=await req.formData()}catch{return reply({error:"invalid_form"},400)}
 const id=form.get("candidate_id"),file=form.get("video"),thumbnail=form.get("thumbnail");
 if(typeof id!=="string"||!/^[0-9a-f-]{36}$/i.test(id)||!(file instanceof File))return reply({error:"candidate_id_and_video_required"},400);
 if(file.size<1024||file.size>30_000_000||!["video/mp4","video/webm"].includes(file.type))return reply({error:"unsupported_video"},422);
 if(thumbnail!==null&&(!(thumbnail instanceof File)||thumbnail.size>2_000_000||!["image/jpeg","image/png","image/webp"].includes(thumbnail.type)))return reply({error:"invalid_thumbnail"},422);
 const db=createClient(url,secret,{auth:{persistSession:false}});
 const {data:c}=await db.from("discovery_candidates").select("*").eq("id",id).eq("status","approved").single();
 if(!c)return reply({error:"not_approved"},409);
 if(c.quality_score<80||c.language!=="en"||!c.rights_verified||!c.license_type||!c.license_evidence_url||!c.reviewed_by)return reply({error:"approval_incomplete"},422);
 const today=new Date().toISOString().slice(0,10)+"T00:00:00Z";
 const {count,error:countError}=await db.from("video_provenance").select("video_id",{count:"exact",head:true}).gte("created_at",today);
 if(countError)return reply({error:"quota_check_failed"},500);
 if((count||0)>=30)return reply({error:"daily_limit_reached"},429);
 const ext=file.type==="video/mp4"?"mp4":"webm",path=`discovery/${id}/source.${ext}`;
 const {error:uploadError}=await db.storage.from("videos").upload(path,file,{contentType:file.type,upsert:false});
 if(uploadError)return reply({error:"storage_upload_failed"},500);
 let thumbUrl:string|null=null,thumbPath:string|null=null;
 if(thumbnail instanceof File){
  thumbPath=`discovery/${id}/cover.${thumbnail.type==="image/png"?"png":thumbnail.type==="image/webp"?"webp":"jpg"}`;
  const {error:e}=await db.storage.from("videos").upload(thumbPath,thumbnail,{contentType:thumbnail.type,upsert:false});
  if(e){await db.storage.from("videos").remove([path]);return reply({error:"thumbnail_upload_failed"},500)}
  thumbUrl=db.storage.from("videos").getPublicUrl(thumbPath).data.publicUrl;
 }
 const mediaUrl=db.storage.from("videos").getPublicUrl(path).data.publicUrl;
 // The DB publication is transactional via a dedicated database function, so a failed provenance insert cannot leave an orphaned public feed record.
 const {data:published,error:publishError}=await db.rpc("publish_discovery_video",{p_candidate_id:id,p_video_url:mediaUrl,p_thumbnail_url:thumbUrl,p_storage_key:path,p_file_size:file.size,p_actor:user.id});
 if(publishError){await db.storage.from("videos").remove([path,...(thumbPath?[thumbPath]:[])]);return reply({error:"publication_failed"},409)}
 return reply({published:true,video_id:published,playback_url:mediaUrl});
});
