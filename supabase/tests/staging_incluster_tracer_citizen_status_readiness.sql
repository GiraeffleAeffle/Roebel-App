\set ON_ERROR_STOP on
\getenv participant_rpc_secret PARTICIPANT_RPC_SECRET

begin;
select set_config('request.headers', jsonb_build_object(
  'x-staging-participant-rpc-secret', :'participant_rpc_secret'
)::text, true) is not null as request_headers_set;
set local role anon;
select public.staging_participant_gateway_citizen_adoption_status_preflight() = jsonb_build_object(
  'migration_id', '20260906_staging_citizen_adoption_status_readiness',
  'database_schema_sha256', :'citizen_status_schema_sha256'
) as status_ready
\gset
\if :status_ready
\else
  \echo 'Citizen status readiness marker did not match the reviewed contract.'
  \quit 1
\endif

do $$
begin
  perform set_config('request.headers', '{}', true);
  perform public.staging_participant_gateway_citizen_adoption_status_preflight();
  raise exception 'Readiness accepted a missing capability' using errcode = 'XX000';
exception when sqlstate 'P0001' then
  if sqlerrm <> 'STAGING_PARTICIPANT_GATEWAY_REQUIRED' then raise; end if;
end;
$$;
reset role;
set local role authenticated;
do $$
begin
  perform public.staging_participant_gateway_citizen_adoption_status_preflight();
  raise exception 'Authenticated role executed readiness' using errcode = 'XX000';
exception when insufficient_privilege then null;
end;
$$;
reset role;

do $$
declare
  v_function text;
  v_change text;
begin
  foreach v_function in array array[
    'public.staging_participant_gateway_get_citizen_status_holder(text,text,text)',
    'public.staging_participant_gateway_read_citizen_adoption_event(text,text)',
    'public.staging_participant_gateway_citizen_adoption_status_preflight()'
  ] loop
    foreach v_change in array array[
      'grant execute on function ' || v_function || ' to public',
      'grant execute on function ' || v_function || ' to authenticated',
      'grant execute on function ' || v_function || ' to service_role',
      'grant execute on function ' || v_function || ' to anon with grant option',
      'revoke execute on function ' || v_function || ' from anon',
      'alter function ' || v_function || ' set search_path = public',
      'alter function ' || v_function || ' security invoker',
      'alter function ' || v_function || ' owner to postgres',
      'alter function ' || v_function || ' immutable',
      'alter function ' || v_function || ' strict'
    ] loop
      begin
        execute v_change;
        perform public.staging_participant_gateway_citizen_adoption_status_preflight();
        raise exception 'Readiness missed drift: %', v_change using errcode = 'XX000';
      exception when sqlstate 'P0001' then
        if sqlerrm <> 'STAGING_PARTICIPANT_CITIZEN_STATUS_CATALOG_DRIFT' then raise; end if;
        -- Each failing subtransaction restores the original function.
      end;
    end loop;
  end loop;

  foreach v_change in array array[
    'drop function public.staging_participant_gateway_get_citizen_status_holder(text,text,text)',
    'drop function public.staging_participant_gateway_read_citizen_adoption_event(text,text)',
    replace(pg_get_functiondef('public.staging_participant_gateway_read_citizen_adoption_event(text,text)'::regprocedure),
      'return v_projection;', 'return null;'),
    replace(pg_get_functiondef('public.staging_participant_gateway_get_citizen_status_holder(text,text,text)'::regprocedure),
      'return jsonb_build_object(', 'return null; return jsonb_build_object('),
    'create function public.staging_participant_gateway_read_citizen_adoption_event(text) returns jsonb language sql as ''select null::jsonb''',
    'create function public.staging_participant_gateway_get_citizen_status_holder(text) returns jsonb language sql as ''select null::jsonb'''
  ] loop
    begin
      execute v_change;
      perform public.staging_participant_gateway_citizen_adoption_status_preflight();
      raise exception 'Readiness missed missing/changed/overloaded lookup' using errcode = 'XX000';
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'STAGING_PARTICIPANT_CITIZEN_STATUS_CATALOG_DRIFT' then raise; end if;
    end;
  end loop;

  begin
    alter table staging_participant_private.staging_participant_citizen_eligibility_receipts disable row level security;
    perform public.staging_participant_gateway_citizen_adoption_status_preflight();
    raise exception 'Readiness missed prerequisite table drift' using errcode = 'XX000';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'STAGING_PARTICIPANT_CITIZEN_ADOPTION_%DRIFT%' then raise; end if;
  end;
  begin
    update public.app_settings set value = 'production' where key = 'roebel_env';
    perform public.staging_participant_gateway_citizen_adoption_status_preflight();
    raise exception 'Readiness accepted unarmed environment' using errcode = 'XX000';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'STAGING_PARTICIPANT_ENVIRONMENT_REQUIRED' then raise; end if;
  end;
end;
$$;

rollback;
\unset participant_rpc_secret
\echo 'Citizen status readiness behavior checks passed.'
