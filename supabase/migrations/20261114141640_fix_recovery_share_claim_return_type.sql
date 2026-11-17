create or replace function private.claim_key_recovery_share(p_recovery_set_id uuid)
returns table(share_index integer,share_value text)
language plpgsql security definer set search_path=''
as $$
declare v_actor uuid := (select auth.uid()); v_claimed_index integer;
begin
 if v_actor is null or not exists(select 1 from private.key_recovery_custodians c where c.user_id=v_actor and c.active) then
   raise exception 'Active recovery custodian required';
 end if;
 return query
 update private.key_recovery_shares s
 set last_claimed_at=now()
 where s.recovery_set_id=p_recovery_set_id and s.custodian_user_id=v_actor
 returning s.share_index::integer,
   (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.id=s.vault_secret_id);
 get diagnostics v_claimed_index = row_count;
 if v_claimed_index=0 then raise exception 'No recovery share assigned to this custodian'; end if;
 insert into private.key_recovery_events(recovery_set_id,actor_id,event_type,outcome,details)
 values(p_recovery_set_id,v_actor,'RECOVERY_SHARE_CLAIMED','SUCCESS',
   jsonb_build_object('share_count',v_claimed_index));
end
$$;;
