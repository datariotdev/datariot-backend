-- Public media compatibility flag only; this does not grant authorization.
-- Older APKs cannot play official embeds and must keep receiving their existing MP4 feed.
create policy "YouTube embeds require a capable client"
on public.videos as restrictive for select to anon, authenticated
using (
  not (coalesce(tags, '{}'::text[]) @> array['youtube-embed']::text[])
  or coalesce(
    (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb ->> 'x-datariot-youtube'),
    '0'
  ) = '1'
);
