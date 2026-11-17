create or replace function private.key_recovery_is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$ select private.is_platform_super_admin(); $$;
create or replace function private.activate_operational_project_scope() returns jsonb language plpgsql security definer set search_path='' as $$
declare v_report jsonb;begin
if (select auth.uid()) is null or not private.is_platform_super_admin() then raise exception 'Platform Super Admin required' using errcode='42501';end if;
v_report:=private.operational_project_scope_readiness();
if (v_report->>'scope_gate_enabled')::boolean then raise exception 'Project scope enforcement is already enabled; it cannot be disabled through this endpoint';end if;
if (v_report->'unscoped_operational_rows') <> '{}'::jsonb and exists(select 1 from jsonb_each_text(v_report->'unscoped_operational_rows') e where e.value::bigint>0) then raise exception 'Cutover blocked: operational rows still lack canonical scope IDs. Read private.operational_project_scope_readiness()';end if;
if (v_report->>'unscoped_audit_rows')::bigint>0 then raise exception 'Cutover blocked: audit events still lack canonical tenant/project scope';end if;
if (v_report->>'unmapped_project_evidence_objects')::bigint>0 then raise exception 'Cutover blocked: project-evidence Storage paths are not project-prefixed';end if;
if (v_report->>'projects_with_operational_rows_without_explicit_project_read_grant')::bigint>0 then raise exception 'Cutover blocked: at least one operational project has no explicit project.read membership grant';end if;
if jsonb_array_length(v_report->'authenticated_executable_legacy_security_definer_mutations')>0 then raise exception 'Cutover blocked: legacy SECURITY DEFINER mutation RPCs still bypass project-scoped RLS';end if;
update private.operational_project_scope_control set enabled=true,enabled_at=now(),enabled_by=(select auth.uid()) where singleton=true and enabled=false;return jsonb_build_object('enabled',true,'enabled_at',now());end;$$;
create or replace function private.revoke_rfin(p_token_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin
update public.rfin_tokens set revoked_at=now() where id=p_token_id and redeemed_at is null and revoked_at is null and (issued_by=(select auth.uid()) or private.is_platform_super_admin());
if not found then raise exception 'Token not found or not authorized';end if;end;$$;
