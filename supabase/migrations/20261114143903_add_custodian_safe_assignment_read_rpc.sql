create or replace function private.get_my_key_recovery_assignments()
returns table(
 recovery_set_id uuid,
 secret_name text,
 recovery_status text,
 threshold integer,
 share_count integer,
 share_index integer,
 custodian_label text,
 my_retrieval_approval_at timestamptz,
 pending_distinct_approvals integer,
 last_verified_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare v_actor uuid := (select auth.uid());
begin
 if v_actor is null then raise exception 'Authentication required'; end if;
 if not exists(select 1 from private.key_recovery_custodians c where c.user_id=v_actor and c.active) then
   raise exception 'Active recovery custodian required';
 end if;
 return query
 select rs.id,rs.secret_name,rs.status,rs.threshold::integer,rs.share_count::integer,
        sh.share_index::integer,c.custodian_label,
        (select a.approved_at from private.key_recovery_approvals a
          where a.recovery_set_id=rs.id and a.custodian_user_id=v_actor
            and a.purpose='RETRIEVAL_DRILL' and a.consumed_at is null
          order by a.approved_at desc limit 1),
        (select count(distinct a.custodian_user_id)::integer from private.key_recovery_approvals a
          join private.key_recovery_custodians ac on ac.user_id=a.custodian_user_id and ac.active
          where a.recovery_set_id=rs.id and a.purpose='RETRIEVAL_DRILL' and a.consumed_at is null),
        rs.last_verified_at
 from private.key_recovery_custodians c
 join private.key_recovery_shares sh on sh.custodian_user_id=c.user_id
 join private.key_recovery_sets rs on rs.id=sh.recovery_set_id and rs.status='ACTIVE'
 where c.user_id=v_actor and c.active;
end
$$;

create or replace function public.get_my_key_recovery_assignments()
returns table(
 recovery_set_id uuid,
 secret_name text,
 recovery_status text,
 threshold integer,
 share_count integer,
 share_index integer,
 custodian_label text,
 my_retrieval_approval_at timestamptz,
 pending_distinct_approvals integer,
 last_verified_at timestamptz
)
language sql
security invoker
set search_path=''
as $$ select * from private.get_my_key_recovery_assignments() $$;

revoke all on function public.get_my_key_recovery_assignments() from public,anon;
grant execute on function public.get_my_key_recovery_assignments() to authenticated;
