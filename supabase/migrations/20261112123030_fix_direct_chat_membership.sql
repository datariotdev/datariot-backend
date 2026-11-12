create function public.get_or_create_direct_chat(recipient_id uuid)
returns uuid
language plpgsql
security invoker
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
        direct_chat_id := pg_catalog.gen_random_uuid();
        -- The chat becomes readable under RLS when the membership rows exist.
        insert into public.chats (id, type) values (direct_chat_id, 'direct');
        insert into public.chat_participants (chat_id, user_id)
        values (direct_chat_id, sender_id), (direct_chat_id, recipient_id);
    end if;

    return direct_chat_id;
end;
$$;

revoke execute on function public.get_or_create_direct_chat(uuid) from public, anon;
grant execute on function public.get_or_create_direct_chat(uuid) to authenticated;
