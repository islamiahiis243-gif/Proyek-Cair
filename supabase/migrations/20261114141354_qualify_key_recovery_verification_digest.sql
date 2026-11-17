create or replace function private.verify_key_recovery_set(p_recovery_set_id uuid,p_purpose text default 'RETRIEVAL_DRILL')
returns boolean language plpgsql security definer set search_path=''
as $$
declare
 v_actor uuid := (select auth.uid());
 v_s1 bytea; v_s2 bytea; v_rebuilt bytea; v_expected text; v_count integer;
 v_x1 integer; v_x2 integer;
begin
 if v_actor is null or not private.key_recovery_is_platform_admin() then raise exception 'Platform Super Admin required'; end if;
 if p_purpose not in ('RECOVERY','RETRIEVAL_DRILL') then raise exception 'Invalid purpose'; end if;
 select count(distinct custodian_user_id) into v_count from private.key_recovery_approvals
 where recovery_set_id=p_recovery_set_id and purpose=p_purpose;
 if v_count<2 then raise exception 'Dual custody approval threshold not met'; end if;
 select s.share_index,decode(ds.decrypted_secret,'base64')
 into v_x1,v_s1
 from private.key_recovery_shares s join vault.decrypted_secrets ds on ds.id=s.vault_secret_id
 join private.key_recovery_approvals a on a.recovery_set_id=s.recovery_set_id and a.custodian_user_id=s.custodian_user_id and a.purpose=p_purpose
 where s.recovery_set_id=p_recovery_set_id order by s.share_index limit 1;
 select s.share_index,decode(ds.decrypted_secret,'base64')
 into v_x2,v_s2
 from private.key_recovery_shares s join vault.decrypted_secrets ds on ds.id=s.vault_secret_id
 join private.key_recovery_approvals a on a.recovery_set_id=s.recovery_set_id and a.custodian_user_id=s.custodian_user_id and a.purpose=p_purpose
 where s.recovery_set_id=p_recovery_set_id and s.share_index<>v_x1 order by s.share_index limit 1;
 if v_s1 is null or v_s2 is null then raise exception 'Two distinct custodian shares are unavailable'; end if;
 v_rebuilt:=private.key_recovery_reconstruct(v_s1,v_x1,v_s2,v_x2);
 select secret_fingerprint into v_expected from private.key_recovery_sets where id=p_recovery_set_id and status='ACTIVE';
 if v_expected is null or encode(extensions.digest(v_rebuilt,'sha256'),'hex')<>v_expected then
   insert into private.key_recovery_events(recovery_set_id,actor_id,event_type,outcome,details)
   values(p_recovery_set_id,v_actor,'RECOVERY_VERIFICATION','FAILED',jsonb_build_object('purpose',p_purpose));
   return false;
 end if;
 update private.key_recovery_sets set last_verified_at=now(),verified_count=verified_count+1 where id=p_recovery_set_id;
 insert into private.key_recovery_events(recovery_set_id,actor_id,event_type,outcome,details)
 values(p_recovery_set_id,v_actor,'RECOVERY_VERIFICATION','SUCCESS',
   jsonb_build_object('purpose',p_purpose,'threshold',2,'shares_used',jsonb_build_array(v_x1,v_x2)));
 return true;
end
$$;;
