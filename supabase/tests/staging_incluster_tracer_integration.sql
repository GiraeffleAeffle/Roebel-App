\set ON_ERROR_STOP on
\getenv participant_rpc_secret PARTICIPANT_RPC_SECRET

select length(:'participant_rpc_secret') >= 32 as rpc_secret_valid
\gset
\if :rpc_secret_valid
\else
  \echo 'Ephemeral participant RPC secret is invalid.'
  \quit 1
\endif

select :'citizen_adoption_schema_sha256' ~ '^sha256:[0-9a-f]{64}$'
  as citizen_adoption_schema_pin_valid
\gset
\if :citizen_adoption_schema_pin_valid
\else
  \echo 'Citizen-adoption schema pin input is invalid.'
  \quit 1
\endif

select not exists (
  select 1
    from pg_catalog.pg_default_acl defaults
    cross join lateral pg_catalog.aclexplode(defaults.defaclacl) acl
    join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
   where defaults.defaclrole = (
     select oid from pg_catalog.pg_roles where rolname = 'supabase_admin'
   )
     and defaults.defaclnamespace = 'public'::pg_catalog.regnamespace
     and defaults.defaclobjtype = 'f'
     and acl.privilege_type = 'EXECUTE'
     and grantee.rolname in (
       'postgres', 'anon', 'authenticated', 'service_role'
     )
) as public_function_defaults_normalized
\gset
\if :public_function_defaults_normalized
\else
  \echo 'Supabase default public-function ACL normalization failed.'
  \quit 1
\endif

select (
  count(*) = 9
  and bool_and(execute_acl_count = 2)
  and bool_and(owner_execute_count = 1)
  and bool_and(anon_execute_count = 1)
  and bool_and(grantable_execute_count = 0)
) as citizen_adoption_rpc_acls_exact
from (
  select target.object_identity,
    count(*) filter (where acl.privilege_type = 'EXECUTE') as execute_acl_count,
    count(*) filter (
      where acl.privilege_type = 'EXECUTE' and acl.grantee = proc.proowner
    ) as owner_execute_count,
    count(*) filter (
      where acl.privilege_type = 'EXECUTE'
        and acl.grantee = (
          select oid from pg_catalog.pg_roles where rolname = 'anon'
        )
    ) as anon_execute_count,
    count(*) filter (
      where acl.privilege_type = 'EXECUTE' and acl.is_grantable
    ) as grantable_execute_count
  from (values
    ('public.staging_participant_gateway_issue_citizen_challenge(jsonb)'),
    ('public.staging_participant_gateway_consume_citizen_challenge(text,text,text,bigint)'),
    ('public.staging_participant_gateway_store_citizen_eligibility_receipt(text,jsonb,jsonb)'),
    ('public.staging_participant_gateway_get_citizen_eligibility_receipt(text)'),
    ('public.staging_participant_gateway_get_citizen_suggestion_root(text,text)'),
    ('public.staging_participant_gateway_resolve_citizen_adoption_replay(text,uuid,text,text,text)'),
    ('public.staging_participant_gateway_accept_citizen_adoption(text,uuid,text,text,bigint,integer,jsonb,jsonb,jsonb)'),
    ('public.staging_participant_gateway_read_public_citizen_adoption(text,text,text)'),
    ('public.staging_participant_gateway_citizen_adoption_preflight()')
  ) target(object_identity)
  join pg_catalog.pg_proc proc
    on proc.oid = pg_catalog.to_regprocedure(target.object_identity)
  cross join lateral pg_catalog.aclexplode(
    coalesce(proc.proacl, pg_catalog.acldefault('f', proc.proowner))
  ) acl
  group by target.object_identity
) reviewed
\gset
\if :citizen_adoption_rpc_acls_exact
\else
  \echo 'Citizen-adoption RPC ACLs are not exactly owner and anon EXECUTE.'
  \quit 1
\endif

select (
  count(*) = 8
  and bool_and(execute_acl_count = 2)
  and bool_and(owner_execute_count = 1)
  and bool_and(anon_execute_count = 1)
  and bool_and(grantable_execute_count = 0)
) as topic_rpc_acls_exact
from (
  select target.object_identity,
    count(*) filter (where acl.privilege_type = 'EXECUTE') as execute_acl_count,
    count(*) filter (
      where acl.privilege_type = 'EXECUTE' and acl.grantee = proc.proowner
    ) as owner_execute_count,
    count(*) filter (
      where acl.privilege_type = 'EXECUTE'
        and acl.grantee = (
          select oid from pg_catalog.pg_roles where rolname = 'anon'
        )
    ) as anon_execute_count,
    count(*) filter (
      where acl.privilege_type = 'EXECUTE' and acl.is_grantable
    ) as grantable_execute_count
  from (values
    ('public.staging_participant_gateway_reserve_source_post_promotion(text,text,uuid,uuid,text,text,text,text,text)'),
    ('public.staging_participant_gateway_complete_source_post_promotion(text,text,uuid,uuid,text,text,text)'),
    ('public.staging_participant_gateway_reserve_topic_suggestion(text,text,text,text,uuid,text,text,text,text,text,text,text)'),
    ('public.staging_participant_gateway_complete_topic_suggestion(text,text,text,text,uuid,text,text,text)'),
    ('public.staging_participant_gateway_bind_published_nostr_post_mirror(text,uuid,text,text)'),
    ('public.staging_participant_gateway_resolve_published_nostr_post_mirror(text,uuid)'),
    ('public.staging_participant_gateway_resolve_published_source_post_promotion(text,text,text,text)'),
    ('public.staging_participant_gateway_topic_tracer_preflight()')
  ) target(object_identity)
  join pg_catalog.pg_proc proc
    on proc.oid = pg_catalog.to_regprocedure(target.object_identity)
  cross join lateral pg_catalog.aclexplode(
    coalesce(proc.proacl, pg_catalog.acldefault('f', proc.proowner))
  ) acl
  group by target.object_identity
) reviewed
\gset
\if :topic_rpc_acls_exact
\else
  \echo 'Topic RPC ACLs are not exactly owner and anon EXECUTE.'
  \quit 1
\endif

\set participant_wallet '0x1111111111111111111111111111111111111111'
\set post_request_id '11111111-1111-4111-8111-111111111111'
\set comment_request_id '22222222-2222-4222-8222-222222222222'
\set post_content '@Mecky, welche belegten Hinweise gibt es zum Radweg?'
\set comment_content '@Mecky, bitte antworte mit sichtbaren Quellen.'

begin;
set local role anon;
select set_config(
  'request.headers',
  jsonb_build_object(
    'x-staging-participant-rpc-secret',
    :'participant_rpc_secret'
  )::text,
  true
) as request_header_configured
\gset

select
  response ->> 'migration_id' as participant_migration_id,
  response ->> 'database_schema_sha256' as participant_schema_sha256
from (
  select public.staging_participant_gateway_preflight() as response
) preflight
\gset
select (
  :'participant_migration_id' = '20260825_staging_participant_gateway'
  and :'participant_schema_sha256' =
    'sha256:a540591c718d4b2c74f56fe7310baf5b522ac6541384223a5263079e207f3d5d'
) as participant_preflight_ok
\gset
\if :participant_preflight_ok
\else
  \echo 'Participant schema preflight did not match the reviewed contract.'
  \quit 1
\endif

select
  response ->> 'migration_id' as topic_migration_id,
  response ->> 'database_schema_sha256' as topic_schema_sha256
from (
  select public.staging_participant_gateway_topic_tracer_preflight() as response
) preflight
\gset
select (
  :'topic_migration_id' = '20260825_staging_participant_topic_tracer'
  and :'topic_schema_sha256' =
    'sha256:298ef4a02f5f299afd157210a1074f179b08478c683bad3ed36430eb013854eb'
) as topic_preflight_ok
\gset
\if :topic_preflight_ok
\else
  \echo 'Topic tracer preflight did not match the reviewed contract.'
  \quit 1
\endif

select
  response ->> 'migration_id' as citizen_adoption_migration_id,
  response ->> 'database_schema_sha256' as citizen_adoption_schema_sha256_actual
from (
  select public.staging_participant_gateway_citizen_adoption_preflight() as response
) preflight
\gset
select (
  :'citizen_adoption_migration_id' = '20260901_staging_citizen_adoption'
  and :'citizen_adoption_schema_sha256_actual' =
    :'citizen_adoption_schema_sha256'
) as citizen_adoption_preflight_ok
\gset
\if :citizen_adoption_preflight_ok
\else
  \echo 'Citizen-adoption preflight did not match the reviewed contract.'
  \quit 1
\endif

select
  response ->> 'id' as created_post_id,
  response ->> 'wallet_address' as created_post_wallet,
  response ->> 'content' as created_post_content,
  response ->> 'feed_type' as created_post_feed_type,
  response ->> 'post_type' as created_post_type,
  response ->> 'category' as created_post_category,
  response ->> 'status' as created_post_status
from (
  select public.staging_participant_gateway_create_main_text_post(
    :'participant_wallet',
    :'post_content',
    :'post_request_id'::uuid
  ) as response
) created
\gset
select (
  :'created_post_wallet' = :'participant_wallet'
  and :'created_post_content' = :'post_content'
  and :'created_post_feed_type' = 'main'
  and :'created_post_type' = 'user'
  and :'created_post_category' = 'generell'
  and :'created_post_status' = 'published'
) as ordinary_post_ok
\gset
\if :ordinary_post_ok
\else
  \echo 'The participant RPC did not create an ordinary main-feed post.'
  \quit 1
\endif

select response ->> 'id' as replayed_post_id
from (
  select public.staging_participant_gateway_create_main_text_post(
    :'participant_wallet',
    :'post_content',
    :'post_request_id'::uuid
  ) as response
) replayed
\gset
select :'replayed_post_id' = :'created_post_id' as post_idempotency_ok
\gset
\if :post_idempotency_ok
\else
  \echo 'The participant post RPC did not preserve request idempotency.'
  \quit 1
\endif

select
  response ->> 'id' as created_comment_id,
  response ->> 'post_id' as created_comment_post_id,
  response ->> 'wallet_address' as created_comment_wallet,
  response ->> 'content' as created_comment_content,
  response ->> 'status' as created_comment_status
from (
  select public.staging_participant_gateway_create_main_text_comment(
    :'participant_wallet',
    :'created_post_id'::uuid,
    :'comment_content',
    :'comment_request_id'::uuid
  ) as response
) created
\gset
select (
  :'created_comment_post_id' = :'created_post_id'
  and :'created_comment_wallet' = :'participant_wallet'
  and :'created_comment_content' = :'comment_content'
  and :'created_comment_status' = 'published'
) as ordinary_comment_ok
\gset
\if :ordinary_comment_ok
\else
  \echo 'The participant RPC did not create an ordinary post reply.'
  \quit 1
\endif

select
  response ->> 'id' as read_post_id,
  response ->> 'comments_count' as read_post_comments_count
from (
  select public.staging_participant_gateway_read_owned_main_text_post(
    :'participant_wallet',
    :'created_post_id'::uuid
  ) as response
) owned
\gset
select (
  :'read_post_id' = :'created_post_id'
  and :'read_post_comments_count' = '1'
) as owned_post_read_ok
\gset
\if :owned_post_read_ok
\else
  \echo 'The owned-post RPC did not return the new post and comment count.'
  \quit 1
\endif

select (
  count(*) = 7
  and count(distinct wallet_address) = 5
  and count(*) filter (
    where id = :'created_post_id'::uuid
      and content = :'post_content'
      and feed_type = 'main'
      and post_type = 'user'
      and status = 'published'
  ) = 1
) as mixed_feed_ok
from public.posts
where feed_type = 'main' and status = 'published'
\gset
\if :mixed_feed_ok
\else
  \echo 'The public timeline is not the expected mixed ordinary feed.'
  \quit 1
\endif

select (
  exists (
    select 1
      from public.users
     where wallet_address = :'participant_wallet'
       and tier = 'guest'
       and is_verified_citizen is false
       and verification_status = 'pending'
  )
  and not exists (
    select 1
      from public.account_owners
     where wallet_address = :'participant_wallet'
  )
  and not has_table_privilege('anon', 'public.posts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.posts', 'INSERT')
) as no_civic_authority_ok
\gset
\if :no_civic_authority_ok
\else
  \echo 'Participant creation crossed the guest/no-authority boundary.'
  \quit 1
\endif

rollback;
\unset participant_rpc_secret
\echo 'Participant database behavior checks passed.'
