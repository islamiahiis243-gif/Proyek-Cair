
alter table private.key_recovery_approvals add column if not exists consumed_at timestamptz;
alter table private.key_recovery_approvals drop constraint if exists key_recovery_approvals_recovery_set_id_custodian_user_id_purpose_key;
create unique index if not exists key_recovery_approvals_pending_unique
on private.key_recovery_approvals(recovery_set_id,custodian_user_id,purpose)
where consumed_at is null;
create unique index if not exists key_recovery_one_share_per_custodian
on private.key_recovery_shares(recovery_set_id,custodian_user_id)
where custodian_user_id is not null;

create or replace function private.approve_key_recovery(p_recovery_set_id uuid,p_purpose text)
returns integer language plpgsql security definer set search_path=''
as $$
declare v_actor uuid := (select auth.uid()); v_count integer;
begin
 if v_actor is null or not exists(select 1 from private.key_recovery_custodians c where c.user_id=v_actor and c.active) then
   raise exception 'Active recovery custodian required';
 end if;
 if p_purpose not in ('RECOVERY','RETRIEVAL_DRILL') then raise exception 'Invalid approval purpose'; end if;
 if not exists(select 1 from private.key_recovery_shares where recovery_set_id=p_recovery_set_id and custodian_user_id=v_actor) then
   raise exception 'Custodian has no assigned share for this recovery set';
 end if;
 insert into private.key_recovery_approvals(recovery_set_id,custodian_user_id,purpose)
 values(p_recovery_set_id,v_actor,p_purpose)
 on conflict (recovery_set_id,custodian_user_id,purpose) where consumed_at is null do nothing;
 select count(distinct custodian_user_id) into v_count from private.key_recovery_approvals
 where recovery_set_id=p_recovery_set_id and purpose=p_purpose and consumed_at is null;
 insert into private.key_recovery_events(recovery_set_id,actor_id,event_type,outcome,details)
 values(p_recovery_set_id,v_actor,'RECOVERY_APPROVAL_RECORDED','SUCCESS',
   jsonb_build_object('purpose',p_purpose,'distinct_pending_approvals',v_count));
 return v_count;
end
$$;

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
 where recovery_set_id=p_recovery_set_id and purpose=p_purpose and consumed_at is null;
 if v_count<2 then raise exception 'Dual custody approval threshold not met'; end if;
 select s.share_index,decode(ds.decrypted_secret,'base64')
 into v_x1,v_s1
 from private.key_recovery_shares s join vault.decrypted_secrets ds on ds.id=s.vault_secret_id
 join private.key_recovery_approvals a on a.recovery_set_id=s.recovery_set_id and a.custodian_user_id=s.custodian_user_id and a.purpose=p_purpose and a.consumed_at is null
 where s.recovery_set_id=p_recovery_set_id order by s.share_index limit 1;
 select s.share_index,decode(ds.decrypted_secret,'base64')
 into v_x2,v_s2
 from private.key_recovery_shares s join vault.decrypted_secrets ds on ds.id=s.vault_secret_id
 join private.key_recovery_approvals a on a.recovery_set_id=s.recovery_set_id and a.custodian_user_id=s.custodian_user_id and a.purpose=p_purpose and a.consumed_at is null
 where s.recovery_set_id=p_recovery_set_id and s.share_index<>v_x1 order by s.share_index limit 1;
 if v_s1 is null or v_s2 is null then raise exception 'Two distinct custodian shares are unavailable'; end if;
 v_rebuilt:=private.key_recovery_reconstruct(v_s1,v_x1,v_s2,v_x2);
 select secret_fingerprint into v_expected from private.key_recovery_sets where id=p_recovery_set_id and status='ACTIVE';
 if v_expected is null or encode(extensions.digest(v_rebuilt,'sha256'),'hex')<>v_expected then
   insert into private.key_recovery_events(recovery_set_id,actor_id,event_type,outcome,details)
   values(p_recovery_set_id,v_actor,'RECOVERY_VERIFICATION','FAILED',jsonb_build_object('purpose',p_purpose));
   update private.key_recovery_approvals set consumed_at=now()
   where recovery_set_id=p_recovery_set_id and purpose=p_purpose and consumed_at is null;
   return false;
 end if;
 update private.key_recovery_sets set last_verified_at=now(),verified_count=verified_count+1 where id=p_recovery_set_id;
 update private.key_recovery_approvals set consumed_at=now()
 where recovery_set_id=p_recovery_set_id and purpose=p_purpose and consumed_at is null;
 insert into private.key_recovery_events(recovery_set_id,actor_id,event_type,outcome,details)
 values(p_recovery_set_id,v_actor,'RECOVERY_VERIFICATION','SUCCESS',
   jsonb_build_object('purpose',p_purpose,'threshold',2,'shares_used',jsonb_build_array(v_x1,v_x2)));
 return true;
end
$$;

create or replace function private.restore_npwp_master_key_from_recovery_set(p_recovery_set_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare
 v_actor uuid := (select auth.uid());
 v_s1 bytea; v_s2 bytea; v_rebuilt bytea; v_expected text;
 v_x1 integer; v_x2 integer; v_count integer;
begin
 if v_actor is null or not private.key_recovery_is_platform_admin() then raise exception 'Platform Super Admin required'; end if;
 select count(distinct custodian_user_id) into v_count from private.key_recovery_approvals
 where recovery_set_id=p_recovery_set_id and purpose='RECOVERY' and consumed_at is null;
 if v_count<2 then raise exception 'Dual custody recovery approval threshold not met'; end if;
 if exists(select 1 from vault.secrets where name='proyek_cair_npwp_master_key') then
   raise exception 'Master key already exists; restore is not allowed to overwrite it';
 end if;
 select s.share_index,decode(ds.decrypted_secret,'base64')
 into v_x1,v_s1
 from private.key_recovery_shares s join vault.decrypted_secrets ds on ds.id=s.vault_secret_id
 join private.key_recovery_approvals a on a.recovery_set_id=s.recovery_set_id and a.custodian_user_id=s.custodian_user_id and a.purpose='RECOVERY' and a.consumed_at is null
 where s.recovery_set_id=p_recovery_set_id order by s.share_index limit 1;
 select s.share_index,decode(ds.decrypted_secret,'base64')
 into v_x2,v_s2
 from private.key_recovery_shares s join vault.decrypted_secrets ds on ds.id=s.vault_secret_id
 join private.key_recovery_approvals a on a.recovery_set_id=s.recovery_set_id and a.custodian_user_id=s.custodian_user_id and a.purpose='RECOVERY' and a.consumed_at is null
 where s.recovery_set_id=p_recovery_set_id and s.share_index<>v_x1 order by s.share_index limit 1;
 if v_s1 is null or v_s2 is null then raise exception 'Two distinct custodian shares are unavailable'; end if;
 v_rebuilt:=private.key_recovery_reconstruct(v_s1,v_x1,v_s2,v_x2);
 select secret_fingerprint into v_expected from private.key_recovery_sets where id=p_recovery_set_id and status='ACTIVE';
 if v_expected is null or encode(extensions.digest(v_rebuilt,'sha256'),'hex')<>v_expected then
   raise exception 'Recovery share integrity verification failed';
 end if;
 perform vault.create_secret(convert_from(v_rebuilt,'UTF8'),'proyek_cair_npwp_master_key',
   'Restored NPWP encryption and fingerprint master key; recovered from 2-of-3 Supabase recovery shares');
 update private.key_recovery_approvals set consumed_at=now()
 where recovery_set_id=p_recovery_set_id and purpose='RECOVERY' and consumed_at is null;
 insert into private.key_recovery_events(recovery_set_id,actor_id,event_type,outcome,details)
 values(p_recovery_set_id,v_actor,'MASTER_KEY_RESTORED','SUCCESS',
   jsonb_build_object('threshold',2,'shares_used',jsonb_build_array(v_x1,v_x2)));
 return true;
end
$$;

create or replace function public.restore_npwp_master_key_from_recovery_set(p_recovery_set_id uuid)
returns boolean language sql security invoker set search_path=''
as $$ select private.restore_npwp_master_key_from_recovery_set(p_recovery_set_id) $$;

revoke all on function private.restore_npwp_master_key_from_recovery_set(uuid) from public,anon,authenticated;
grant execute on function private.restore_npwp_master_key_from_recovery_set(uuid) to authenticated;
grant execute on function public.restore_npwp_master_key_from_recovery_set(uuid) to authenticated;
;
