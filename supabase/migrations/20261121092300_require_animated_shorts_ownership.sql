-- Preserve existing upload paths while requiring authorship for Animated Shorts.
create policy "Animated shorts require the author on insert"
on public.videos as restrictive for insert to anon, authenticated
with check (
  category is distinct from 'animated-shorts'
  or user_id = (select auth.uid())
);

create policy "Animated shorts require the author on update"
on public.videos as restrictive for update to anon, authenticated
using (
  category is distinct from 'animated-shorts'
  or user_id = (select auth.uid())
)
with check (
  category is distinct from 'animated-shorts'
  or user_id = (select auth.uid())
);
