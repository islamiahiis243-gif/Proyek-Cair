create or replace function private.create_npwp_master_key_recovery_set()
returns uuid language plpgsql security definer set search_path=''
as $$
declare
 v_actor uuid := (select auth.uid());
 v_master text;
 v_secret bytea;
 v_coeff bytea;
 v_set uuid;
 v_share bytea;
 v_share_id uuid;
 i integer;
begin
 if v_actor is null or not private.key_recovery_is_platform_admin() then
   raise exception 'Platform Super Admin required';
 end if;
 if exists(select 1 from private.key_recovery_sets where secret_name='proyek_cair_npwp_master_key' and status='ACTIVE') then
   raise exception 'An active recovery set already exists';
 end if;
 select decrypted_secret into v_master from vault.decrypted_secrets
 where name='proyek_cair_npwp_master_key' limit 1;
 if v_master is null or length(v_master)<32 then raise exception 'NPWP master key unavailable or invalid'; end if;
 v_secret:=convert_to(v_master,'UTF8');
 v_coeff:=extensions.gen_random_bytes(octet_length(v_secret));
 insert into private.key_recovery_sets(secret_name,secret_fingerprint,created_by)
 values('proyek_cair_npwp_master_key',encode(extensions.digest(v_secret,'sha256'),'hex'),v_actor)
 returning id into v_set;
 for i in 1..3 loop
   v_share:=private.key_recovery_split_secret(v_secret,v_coeff,i);
   select vault.create_secret(encode(v_share,'base64'),
      'proyek_cair_npwp_recovery_'||replace(v_set::text,'-','')||'_share_'||i,
      '2-of-3 recovery share; set='||v_set::text||'; index='||i::text)
   into v_share_id;
   insert into private.key_recovery_shares(recovery_set_id,share_index,vault_secret_id)
   values(v_set,i,v_share_id);
 end loop;
 insert into private.key_recovery_events(recovery_set_id,actor_id,event_type,outcome,details)
 values(v_set,v_actor,'RECOVERY_SET_CREATED','SUCCESS',
   jsonb_build_object('threshold',2,'share_count',3,'secret_name','proyek_cair_npwp_master_key'));
 return v_set;
exception when others then
 if v_set is not null then
   insert into private.key_recovery_events(recovery_set_id,actor_id,event_type,outcome,details)
   values(v_set,v_actor,'RECOVERY_SET_CREATED','FAILED',jsonb_build_object('sqlstate',sqlstate));
 end if;
 raise;
end
$$;;
