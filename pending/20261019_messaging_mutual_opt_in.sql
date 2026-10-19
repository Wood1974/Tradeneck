-- Mutual opt-in messaging. Apply ONLY together with the frontend in
-- assets/app.js that handles requests (respondToRequest / setComposerStatus).
-- Applying it first breaks sending in the live UI, because the current app
-- writes to threads that would then be pending.
-- Move to tradedeck-api/supabase/migrations on merge.

-- 1. New threads start as a request. Existing threads are returned unchanged.
create or replace function public.start_conversation(p_other uuid, p_job_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare me uuid := auth.uid(); cid uuid;
begin
  if me is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_other is null or p_other = me then raise exception 'Pick someone else to message' using errcode = '22023'; end if;
  if not exists (select 1 from profiles where id = p_other) then raise exception 'User not found' using errcode = 'P0002'; end if;

  select m1.conversation_id into cid
    from conversation_members m1
    join conversation_members m2 on m2.conversation_id = m1.conversation_id and m2.user_id = p_other
   where m1.user_id = me
     and (select count(*) from conversation_members m3 where m3.conversation_id = m1.conversation_id) = 2
   limit 1;

  if cid is not null then
    if p_job_id is not null then
      update conversations set job_id = p_job_id where id = cid and job_id is null;
    end if;
    return cid;
  end if;

  if (select count(*) from conversations c join conversation_members m on m.conversation_id = c.id
       where m.user_id = me and c.created_at > now() - interval '1 day') >= 30 then
    raise exception 'Too many new conversations today' using errcode = 'P0001';
  end if;

  insert into conversations(job_id, status, requested_by) values (p_job_id, 'pending', me) returning id into cid;
  insert into conversation_members(conversation_id, user_id, last_read_at) values (cid, me, now()), (cid, p_other, null);
  return cid;
end $function$;

-- 2. Only accepted threads accept messages. alter policy, not drop, so the
--    auto-cancel on DROP doesn't bite.
alter policy "Members can send messages" on public.messages
  with check (
    auth.uid() = sender_id
    and is_conversation_member(conversation_id)
    and exists (select 1 from conversations c where c.id = conversation_id and c.status = 'accepted')
  );
