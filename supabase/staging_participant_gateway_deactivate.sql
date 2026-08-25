-- Catalog-bound compatibility deactivation for ADR 0021.
--
-- Run only after the five ingress routes have been removed. This preserves all
-- participant audit/admission rows and public staging evidence while restoring
-- the exact function definition and grants captured by the activation
-- transaction. It intentionally does not drop the dedicated private schema.

begin;

do $$
declare
  v_definition text;
  v_grantee text;
  v_grant record;
begin
  if not exists (
    select 1
      from staging_participant_private.staging_participant_environment
     where singleton and environment = 'staging'
  ) then
    raise exception 'STAGING_PARTICIPANT_DEACTIVATION_REQUIRES_ARMED_CATALOG'
      using errcode = 'P0001';
  end if;

  update staging_participant_private.staging_participant_admissions
     set revoked_at = coalesce(revoked_at, now());

  revoke all on function public.staging_participant_gateway_create_main_text_post(text, text, uuid)
    from public, anon, authenticated;
  revoke all on function public.staging_participant_gateway_create_main_text_comment(text, uuid, text, uuid)
    from public, anon, authenticated;

  -- Normalize the exact activation-owned privilege surface before restoring
  -- the captured baseline, so grants added during the activation window do not
  -- survive as hidden rollback drift.
  revoke insert, update, delete on table public.posts
    from public, anon, authenticated;
  revoke insert, update, delete on table public.post_comments
    from public, anon, authenticated;
  revoke insert, delete on table public.post_likes
    from public, anon, authenticated;
  revoke insert, update, delete on table public.app_settings
    from public, anon, authenticated;
  revoke all on function public.delete_owned_post(uuid, text)
    from public, anon, authenticated;
  revoke all on function public.delete_owned_post_comment(uuid, text)
    from public, anon, authenticated;
  revoke all on function public.delete_owned_experience(uuid, text)
    from public, anon, authenticated;
  revoke all on function public.pin_own_post(uuid, text, boolean)
    from public, anon, authenticated;

  select definition into strict v_definition
    from staging_participant_private.staging_participant_prior_function_definitions
   where object_identity = 'public.enforce_posting_rules()';
  execute v_definition;

  for v_grant in
    select *
      from staging_participant_private.staging_participant_prior_privileges
     order by object_kind, object_identity, grantee, privilege_type
  loop
    v_grantee := case
      when v_grant.grantee = 'PUBLIC' then 'PUBLIC'
      else pg_catalog.format('%I', v_grant.grantee)
    end;
    if v_grant.object_kind = 'table' then
      execute pg_catalog.format(
        'grant %s on table %s to %s%s',
        v_grant.privilege_type,
        v_grant.object_identity,
        v_grantee,
        case when v_grant.is_grantable then ' with grant option' else '' end
      );
    elsif v_grant.object_kind = 'function' then
      execute pg_catalog.format(
        'grant %s on function %s to %s%s',
        v_grant.privilege_type,
        v_grant.object_identity,
        v_grantee,
        case when v_grant.is_grantable then ' with grant option' else '' end
      );
    else
      raise exception 'STAGING_PARTICIPANT_DEACTIVATION_CAPTURE_INVALID'
        using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

commit;
