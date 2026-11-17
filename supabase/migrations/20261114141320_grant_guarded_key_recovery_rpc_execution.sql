grant execute on function private.create_npwp_master_key_recovery_set() to authenticated;
grant execute on function private.enroll_key_recovery_custodian(uuid,text) to authenticated;
grant execute on function private.assign_key_recovery_share(uuid,integer,uuid) to authenticated;
grant execute on function private.claim_key_recovery_share(uuid) to authenticated;
grant execute on function private.approve_key_recovery(uuid,text) to authenticated;
grant execute on function private.verify_key_recovery_set(uuid,text) to authenticated;;
