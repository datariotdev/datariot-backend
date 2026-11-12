create schema if not exists private;
grant usage on schema private to authenticated;

create index if not exists chat_participants_user_id_chat_id_idx
    on public.chat_participants (user_id, chat_id);

create index if not exists messages_chat_id_created_at_idx
    on public.messages (chat_id, created_at desc);

create function private.get_or_create_direct_chat(recipient_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    sender_id uuid := auth.uid();
    direct_chat_id uuid;
begin
    if sender_id is null then
        raise exception 'Sign in to open a conversation.' using errcode = '42501';
    end if;

    if recipient_id is null or recipient_id = sender_id then
        raise exception 'Choose another user to message.' using errcode = '22023';
    end if;

    if not exists (select 1 from public.profiles where id = recipient_id) then
        raise exception 'The recipient is unavailable.' using errcode = '22023';
    end if;

    -- Concurrent opens by either participant must resolve to the same chat.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
        least(sender_id, recipient_id)::text || ':' || greatest(sender_id, recipient_id)::text, 0
    ));

    select chat.id into direct_chat_id
    from public.chats chat
    join public.chat_participants sender on sender.chat_id = chat.id and sender.user_id = sender_id
    join public.chat_participants recipient on recipient.chat_id = chat.id and recipient.user_id = recipient_id
    where chat.type = 'direct'
      and not exists (
          select 1 from public.chat_participants member
          where member.chat_id = chat.id and member.user_id not in (sender_id, recipient_id)
      )
    order by chat.created_at, chat.id
    limit 1;

    if direct_chat_id is null then
        insert into public.chats (type) values ('direct') returning id into direct_chat_id;
        insert into public.chat_participants (chat_id, user_id)
        values (direct_chat_id, sender_id), (direct_chat_id, recipient_id);
    end if;

    return direct_chat_id;
end;
$$;

create function public.get_or_create_direct_chat(recipient_id uuid)
returns uuid
language sql
security invoker
set search_path = ''
as $$
    select private.get_or_create_direct_chat(recipient_id);
$$;

revoke execute on function private.get_or_create_direct_chat(uuid) from public, anon;
revoke execute on function public.get_or_create_direct_chat(uuid) from public, anon;
grant execute on function private.get_or_create_direct_chat(uuid) to authenticated;
grant execute on function public.get_or_create_direct_chat(uuid) to authenticated;

-- Conversation membership is created through the authenticated transaction above.
drop policy if exists "Users can create chats" on public.chats;
drop policy if exists "Users can add participants" on public.chat_participants;
drop policy if exists "Users can insert participants" on public.chat_participants;
drop policy if exists "Users can update their own participant details" on public.chat_participants;

do $$
begin
    if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
       and not exists (
           select 1 from pg_catalog.pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
       ) then
        alter publication supabase_realtime add table public.messages;
    end if;
end;
$$;
