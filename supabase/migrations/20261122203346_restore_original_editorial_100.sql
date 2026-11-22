-- Restore the first editorial collection without deleting videos or engagement.
-- Remove the archive tag to restore any later editorial item.
do $$
declare original_count integer;
begin
  select count(*) into original_count
  from public.videos v join public.profiles p on p.id = v.user_id
  where p.username = 'datariot_editorial'
    and v.s3_key ~ '^editorial/hd-2026-11/(00[1-9]|0[1-9][0-9]|100)\.mp4$';
  if original_count <> 100 then
    raise exception 'Expected the original 100 editorial videos, found %', original_count;
  end if;
end $$;

update public.videos v
set tags = array_append(coalesce(v.tags, '{}'::text[]), 'datariot-editorial-archived-2026-11-23')
from public.profiles p
where p.id = v.user_id and p.username = 'datariot_editorial'
  and not (coalesce(v.s3_key, '') ~ '^editorial/hd-2026-11/(00[1-9]|0[1-9][0-9]|100)\.mp4$')
  and not (coalesce(v.tags, '{}'::text[]) @> array['datariot-editorial-archived-2026-11-23']::text[]);

create policy "Hide archived editorial videos"
on public.videos as restrictive for select to anon, authenticated
using (not (coalesce(tags, '{}'::text[]) @> array['datariot-editorial-archived-2026-11-23']::text[]));
