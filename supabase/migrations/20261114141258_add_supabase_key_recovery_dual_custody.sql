
create schema if not exists private;

create table if not exists private.key_recovery_custodians (
  user_id uuid primary key references auth.users(id) on delete restrict,
  custodian_label text not null,
  active boolean not null default true,
  enrolled_by uuid not null references auth.users(id),
  enrolled_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  constraint key_recovery_custodian_label_nonempty check (length(btrim(custodian_label)) between 2 and 80),
  constraint key_recovery_custodian_revocation_pair check ((revoked_by is null) = (revoked_at is null))
);

create table if not exists private.key_recovery_sets (
  id uuid primary key default gen_random_uuid(),
  secret_name text not null,
  secret_fingerprint text not null,
  threshold smallint not null default 2 check (threshold = 2),
  share_count smallint not null default 3 check (share_count = 3),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','SUPERSEDED','REVOKED')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  last_verified_at timestamptz,
  verified_count integer not null default 0 check (verified_count >= 0)
);

create table if not exists private.key_recovery_shares (
  id uuid primary key default gen_random_uuid(),
  recovery_set_id uuid not null references private.key_recovery_sets(id) on delete restrict,
  share_index smallint not null check (share_index between 1 and 3),
  vault_secret_id uuid not null unique,
  custodian_user_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  last_claimed_at timestamptz,
  unique (recovery_set_id, share_index)
);

create table if not exists private.key_recovery_approvals (
  id uuid primary key default gen_random_uuid(),
  recovery_set_id uuid not null references private.key_recovery_sets(id) on delete restrict,
  custodian_user_id uuid not null references auth.users(id) on delete restrict,
  purpose text not null check (purpose in ('RECOVERY','RETRIEVAL_DRILL')),
  approved_at timestamptz not null default now(),
  unique (recovery_set_id, custodian_user_id, purpose)
);

create table if not exists private.key_recovery_events (
  id bigint generated always as identity primary key,
  recovery_set_id uuid references private.key_recovery_sets(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  outcome text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table private.key_recovery_custodians enable row level security;
alter table private.key_recovery_sets enable row level security;
alter table private.key_recovery_shares enable row level security;
alter table private.key_recovery_approvals enable row level security;
alter table private.key_recovery_events enable row level security;

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.key_recovery_is_platform_admin()
returns boolean language sql stable security definer set search_path=''
as $$
 select exists (
   select 1 from public.platform_admins pa
   where pa.user_id=(select auth.uid()) and pa.admin_role='PLATFORM_SUPER_ADMIN'
 )
$$;
revoke all on function private.key_recovery_is_platform_admin() from public, anon, authenticated;

create or replace function private.key_recovery_gf_mul(a integer,b integer)
returns integer language plpgsql immutable strict set search_path=''
as $$
declare
 x integer:=a; y integer:=b; z integer:=0; i integer; hi integer;
begin
 if x<0 or x>255 or y<0 or y>255 then raise exception 'GF256 operand out of range'; end if;
 for i in 1..8 loop
   if (y & 1)=1 then z:=z # x; end if;
   hi:=x & 128;
   x:=(x << 1) & 255;
   if hi=128 then x:=x # 27; end if;
   y:=y >> 1;
 end loop;
 return z;
end
$$;

create or replace function private.key_recovery_gf_inv(a integer)
returns integer language plpgsql immutable strict set search_path=''
as $$
declare result integer:=1; base integer:=a; power integer:=254;
begin
 if a<1 or a>255 then raise exception 'GF256 inverse undefined'; end if;
 while power>0 loop
   if (power & 1)=1 then result:=private.key_recovery_gf_mul(result,base); end if;
   base:=private.key_recovery_gf_mul(base,base);
   power:=power >> 1;
 end loop;
 return result;
end
$$;

create or replace function private.key_recovery_split_secret(p_secret bytea,p_coefficient bytea,p_x integer)
returns bytea language plpgsql immutable strict set search_path=''
as $$
declare result bytea:=decode(repeat('00',octet_length(p_secret)),'hex'); i integer;
begin
 if octet_length(p_secret)<>octet_length(p_coefficient) or p_x not between 1 and 3 then
   raise exception 'Invalid Shamir share input';
 end if;
 for i in 0..octet_length(p_secret)-1 loop
   result:=set_byte(result,i,get_byte(p_secret,i) # private.key_recovery_gf_mul(get_byte(p_coefficient,i),p_x));
 end loop;
 return result;
end
$$;

create or replace function private.key_recovery_reconstruct(p_share_a bytea,p_xa integer,p_share_b bytea,p_xb integer)
returns bytea language plpgsql immutable strict set search_path=''
as $$
declare result bytea:=decode(repeat('00',octet_length(p_share_a)),'hex'); i integer; denom integer; inv integer; la integer; lb integer;
begin
 if octet_length(p_share_a)<>octet_length(p_share_b) or p_xa=p_xb or p_xa not between 1 and 3 or p_xb not between 1 and 3 then
   raise exception 'Invalid Shamir reconstruction inputs';
 end if;
 denom:=p_xa # p_xb;
 inv:=private.key_recovery_gf_inv(denom);
 la:=private.key_recovery_gf_mul(p_xb,inv);
 lb:=private.key_recovery_gf_mul(p_xa,inv);
 for i in 0..octet_length(p_share_a)-1 loop
   result:=set_byte(result,i,
     private.key_recovery_gf_mul(get_byte(p_share_a,i),la) #
     private.key_recovery_gf_mul(get_byte(p_share_b,i),lb));
 end loop;
 return result;
end
$$;

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

 select decrypted_secret into v_master
 from vault.decrypted_secrets
 where name='proyek_cair_npwp_master_key'
 limit 1;
 if v_master is null or length(v_master)<32 then
   raise exception 'NPWP master key unavailable or invalid';
 end if;

 v_secret:=convert_to(v_master,'UTF8');
 v_coeff:=gen_random_bytes(octet_length(v_secret));

 insert into private.key_recovery_sets(secret_name,secret_fingerprint,created_by)
 values('proyek_cair_npwp_master_key',encode(digest(v_secret,'sha256'),'hex'),v_actor)
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
$$;

create or replace function private.enroll_key_recovery_custodian(p_user_id uuid,p_label text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_actor uuid := (select auth.uid());
begin
 if v_actor is null or not private.key_recovery_is_platform_admin() then raise exception 'Platform Super Admin required'; end if;
 if p_user_id is null or p_user_id=v_actor then
   if p_user_id is null then raise exception 'Custodian user is required'; end if;
 end if;
 if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Custodian Auth user not found'; end if;
 insert into private.key_recovery_custodians(user_id,custodian_label,enrolled_by)
 values(p_user_id,p_label,v_actor)
 on conflict(user_id) do update set custodian_label=excluded.custodian_label,active=true,revoked_by=null,revoked_at=null;
 insert into private.key_recovery_events(actor_id,event_type,outcome,details)
 values(v_actor,'CUSTODIAN_ENROLLED','SUCCESS',jsonb_build_object('custodian_user_id',p_user_id,'label',p_label));
end
$$;

create or replace function private.assign_key_recovery_share(p_recovery_set_id uuid,p_share_index integer,p_custodian_user_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_actor uuid := (select auth.uid());
begin
 if v_actor is null or not private.key_recovery_is_platform_admin() then raise exception 'Platform Super Admin required'; end if;
 if p_share_index not between 1 and 3 then raise exception 'Invalid share index'; end if;
 if not exists(select 1 from private.key_recovery_custodians where user_id=p_custodian_user_id and active) then
   raise exception 'Active custodian not enrolled';
 end if;
 update private.key_recovery_shares
 set custodian_user_id=p_custodian_user_id
 where recovery_set_id=p_recovery_set_id and share_index=p_share_index;
 if not found then raise exception 'Recovery share not found'; end if;
 insert into private.key_recovery_events(recovery_set_id,actor_id,event_type,outcome,details)
 values(p_recovery_set_id,v_actor,'SHARE_ASSIGNED','SUCCESS',
   jsonb_build_object('share_index',p_share_index,'custodian_user_id',p_custodian_user_id));
end
$$;

create or replace function private.claim_key_recovery_share(p_recovery_set_id uuid)
returns table(share_index integer,share_value text)
language plpgsql security definer set search_path=''
as $$
declare v_actor uuid := (select auth.uid());
begin
 if v_actor is null or not exists(select 1 from private.key_recovery_custodians c where c.user_id=v_actor and c.active) then
   raise exception 'Active recovery custodian required';
 end if;
 return query
 update private.key_recovery_shares s
 set last_claimed_at=now()
 where s.recovery_set_id=p_recovery_set_id and s.custodian_user_id=v_actor
 returning s.share_index,
   (select ds.decrypted_secret from vault.decrypted_secrets ds where ds.id=s.vault_secret_id);
 if not found then raise exception 'No recovery share assigned to this custodian'; end if;
 insert into private.key_recovery_events(recovery_set_id,actor_id,event_type,outcome,details)
 values(p_recovery_set_id,v_actor,'RECOVERY_SHARE_CLAIMED','SUCCESS',
   jsonb_build_object('share_index',(select share_index from private.key_recovery_shares where recovery_set_id=p_recovery_set_id and custodian_user_id=v_actor)));
end
$$;

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
 on conflict(recovery_set_id,custodian_user_id,purpose) do nothing;
 select count(distinct custodian_user_id) into v_count from private.key_recovery_approvals
 where recovery_set_id=p_recovery_set_id and purpose=p_purpose;
 insert into private.key_recovery_events(recovery_set_id,actor_id,event_type,outcome,details)
 values(p_recovery_set_id,v_actor,'RECOVERY_APPROVAL_RECORDED','SUCCESS',
   jsonb_build_object('purpose',p_purpose,'distinct_approvals',v_count));
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
 if v_expected is null or encode(digest(v_rebuilt,'sha256'),'hex')<>v_expected then
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
$$;

create or replace function public.create_npwp_master_key_recovery_set()
returns uuid language sql security invoker set search_path=''
as $$ select private.create_npwp_master_key_recovery_set() $$;

create or replace function public.enroll_key_recovery_custodian(p_user_id uuid,p_label text)
returns void language sql security invoker set search_path=''
as $$ select private.enroll_key_recovery_custodian(p_user_id,p_label) $$;

create or replace function public.assign_key_recovery_share(p_recovery_set_id uuid,p_share_index integer,p_custodian_user_id uuid)
returns void language sql security invoker set search_path=''
as $$ select private.assign_key_recovery_share(p_recovery_set_id,p_share_index,p_custodian_user_id) $$;

create or replace function public.claim_key_recovery_share(p_recovery_set_id uuid)
returns table(share_index integer,share_value text) language sql security invoker set search_path=''
as $$ select * from private.claim_key_recovery_share(p_recovery_set_id) $$;

create or replace function public.approve_key_recovery(p_recovery_set_id uuid,p_purpose text)
returns integer language sql security invoker set search_path=''
as $$ select private.approve_key_recovery(p_recovery_set_id,p_purpose) $$;

create or replace function public.verify_key_recovery_set(p_recovery_set_id uuid,p_purpose text default 'RETRIEVAL_DRILL')
returns boolean language sql security invoker set search_path=''
as $$ select private.verify_key_recovery_set(p_recovery_set_id,p_purpose) $$;

revoke all on function private.key_recovery_gf_mul(integer,integer) from public,anon,authenticated;
revoke all on function private.key_recovery_gf_inv(integer) from public,anon,authenticated;
revoke all on function private.key_recovery_split_secret(bytea,bytea,integer) from public,anon,authenticated;
revoke all on function private.key_recovery_reconstruct(bytea,integer,bytea,integer) from public,anon,authenticated;
revoke all on function private.create_npwp_master_key_recovery_set() from public,anon,authenticated;
revoke all on function private.enroll_key_recovery_custodian(uuid,text) from public,anon,authenticated;
revoke all on function private.assign_key_recovery_share(uuid,integer,uuid) from public,anon,authenticated;
revoke all on function private.claim_key_recovery_share(uuid) from public,anon,authenticated;
revoke all on function private.approve_key_recovery(uuid,text) from public,anon,authenticated;
revoke all on function private.verify_key_recovery_set(uuid,text) from public,anon,authenticated;
grant execute on function public.create_npwp_master_key_recovery_set() to authenticated;
grant execute on function public.enroll_key_recovery_custodian(uuid,text) to authenticated;
grant execute on function public.assign_key_recovery_share(uuid,integer,uuid) to authenticated;
grant execute on function public.claim_key_recovery_share(uuid) to authenticated;
grant execute on function public.approve_key_recovery(uuid,text) to authenticated;
grant execute on function public.verify_key_recovery_set(uuid,text) to authenticated;

do $$
declare v_admin uuid;
begin
 select user_id into v_admin from public.platform_admins where admin_role='PLATFORM_SUPER_ADMIN' order by granted_at limit 1;
 if v_admin is not null then
   insert into private.key_recovery_custodians(user_id,custodian_label,enrolled_by)
   values(v_admin,'Initial Platform Super Admin Custodian',v_admin)
   on conflict(user_id) do nothing;
 end if;
end $$;
;
