-- Catalog-bound compatibility deactivation for ADR 0021.
--
-- Run only after the six ingress routes have been removed. This preserves all
-- participant audit/admission rows and public staging evidence while restoring
-- the exact function definition and grants captured by the activation
-- transaction. It intentionally does not drop the dedicated private schema.

begin;

do $$
declare
  v_definition text;
  v_grantee text;
  v_grant record;
  v_marker staging_participant_private.staging_participant_schema_contract%rowtype;
begin
  if not exists (
    select 1
      from staging_participant_private.staging_participant_environment
     where singleton and environment = 'staging'
  ) then
    raise exception 'STAGING_PARTICIPANT_DEACTIVATION_REQUIRES_ARMED_CATALOG'
      using errcode = 'P0001';
  end if;

  -- Validate all rollback evidence before this transaction revokes a grant,
  -- revokes an admission or executes a captured definition. The marker binds
  -- the exact activation-time rowsets; it does not claim to reconstruct an
  -- unavailable historic migration file.
  select * into strict v_marker
    from staging_participant_private.staging_participant_schema_contract
   where singleton;
  if v_marker.migration_id <> '20260825_staging_participant_gateway'
     or v_marker.prior_function_definitions_sha256 is null
     or v_marker.prior_privileges_sha256 is null
     or (select count(*) from staging_participant_private.staging_participant_prior_function_definitions) <> 1
     or not exists (
       select 1 from staging_participant_private.staging_participant_prior_function_definitions
        where object_identity = 'public.enforce_posting_rules()'
          and definition <> ''
     ) or exists (
       select 1 from staging_participant_private.staging_participant_prior_function_definitions
        where object_identity <> 'public.enforce_posting_rules()'
     ) or exists (
       select 1 from staging_participant_private.staging_participant_prior_privileges
        where (object_kind = 'table' and (column_name <> '' or object_identity not in (
                 'public.posts', 'public.post_comments', 'public.post_likes', 'public.app_settings')))
           or (object_kind = 'table_column' and (column_name = '' or object_identity not in (
                 'public.posts', 'public.post_comments', 'public.post_likes', 'public.app_settings')))
           or (object_kind = 'function' and (column_name <> '' or object_identity not in (
                 'public.delete_owned_post(uuid,text)',
                 'public.delete_owned_post_comment(uuid,text)',
                 'public.delete_owned_experience(uuid,text)',
                 'public.pin_own_post(uuid,text,boolean)')))
           or object_kind not in ('table', 'table_column', 'function')
           or grantee not in ('PUBLIC', 'anon', 'authenticated')
           or (object_kind = 'table' and privilege_type not in ('INSERT', 'UPDATE', 'DELETE'))
           or (object_kind = 'table_column' and privilege_type not in ('INSERT', 'UPDATE'))
           or (object_kind = 'function' and privilege_type <> 'EXECUTE')
     ) or v_marker.prior_function_definitions_sha256 <> (
       select encode(extensions.digest(coalesce(string_agg(
         object_identity || E'\x1f' || definition, E'\x1e' order by object_identity
       ), ''), 'sha256'), 'hex')
         from staging_participant_private.staging_participant_prior_function_definitions
     ) or v_marker.prior_privileges_sha256 <> (
       select encode(extensions.digest(coalesce(string_agg(
         object_kind || E'\x1f' || object_identity || E'\x1f' || column_name || E'\x1f' ||
         grantee || E'\x1f' || privilege_type || E'\x1f' || is_grantable::text,
         E'\x1e' order by object_kind, object_identity, column_name, grantee, privilege_type
       ), ''), 'sha256'), 'hex')
         from staging_participant_private.staging_participant_prior_privileges
     ) then
    raise exception 'STAGING_PARTICIPANT_DEACTIVATION_CAPTURE_INVALID'
      using errcode = 'P0001';
  end if;

  update staging_participant_private.staging_participant_admissions
     set revoked_at = coalesce(revoked_at, now());

  revoke all on function public.staging_participant_gateway_create_main_text_post(text, text, uuid)
    from public, anon, authenticated;
  revoke all on function public.staging_participant_gateway_create_main_text_comment(text, uuid, text, uuid)
    from public, anon, authenticated;
  revoke all on function public.staging_participant_gateway_read_owned_main_text_post(text, uuid)
    from public, anon, authenticated;
  revoke all on function public.staging_participant_gateway_reserve_nostr_post_mirror(text, uuid, uuid, text, bigint, text)
    from public, anon, authenticated;
  revoke all on function public.staging_participant_gateway_complete_nostr_post_mirror(text, uuid, uuid, text, text)
    from public, anon, authenticated;
  revoke all on function public.staging_participant_gateway_preflight()
    from public, anon, authenticated;

  -- Normalize the exact activation-owned privilege surface before restoring
  -- the captured baseline, so grants added during the activation window do not
  -- survive as hidden rollback drift.
  revoke insert, update, delete on table public.posts
    from public, anon, authenticated;
  revoke insert, update, delete on table public.post_comments
    from public, anon, authenticated;
  revoke insert, update, delete on table public.post_likes
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

  -- Activation closed explicit INSERT/UPDATE column grants as well as table
  -- grants. Normalize those columns before replaying the captured baseline.
  for v_grant in
    select n.nspname, c.relname, a.attname
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid
        and a.attnum > 0 and not a.attisdropped
     where n.nspname = 'public'
       and c.relname in ('posts', 'post_comments', 'post_likes', 'app_settings')
  loop
    execute pg_catalog.format(
      'revoke insert (%I), update (%I) on table %I.%I from public, anon, authenticated',
      v_grant.attname, v_grant.attname, v_grant.nspname, v_grant.relname
    );
  end loop;

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
    elsif v_grant.object_kind = 'table_column' then
      execute pg_catalog.format(
        'grant %s (%I) on table %s to %s%s',
        v_grant.privilege_type,
        v_grant.column_name,
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
