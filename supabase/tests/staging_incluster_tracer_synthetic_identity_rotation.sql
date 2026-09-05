\set ON_ERROR_STOP on
-- The v1 behavioral fixture has committed one exact accepted proof in this
-- disposable PostgreSQL instance. Record all affected rows and normal posts.
create temp table identity_rotation_before as
select 'challenges' as kind, coalesce(jsonb_agg(to_jsonb(t) order by challenge_id),'[]') as rows
 from staging_participant_private.staging_participant_synthetic_citizen_challenges t
union all select 'adoptions',coalesce(jsonb_agg(to_jsonb(t) order by request_id),'[]')
 from staging_participant_private.staging_participant_synthetic_citizen_adoptions t
union all select 'posts',coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.posts t;

\i supabase/migrations/20260905_staging_synthetic_citizen_pass_v2.sql
-- Exact retry is permitted and must not change any historical row either.
\i supabase/migrations/20260905_staging_synthetic_citizen_pass_v2.sql

do $preserved$
begin
 if (select rows from identity_rotation_before where kind='challenges') is distinct from
   (select coalesce(jsonb_agg(to_jsonb(t) order by challenge_id),'[]') from staging_participant_private.staging_participant_synthetic_citizen_challenges t)
 or (select rows from identity_rotation_before where kind='adoptions') is distinct from
   (select coalesce(jsonb_agg(to_jsonb(t) order by request_id),'[]') from staging_participant_private.staging_participant_synthetic_citizen_adoptions t)
 or (select rows from identity_rotation_before where kind='posts') is distinct from
   (select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.posts t) then
   raise exception 'Identity rotation changed historical records';
 end if;
 if (select count(*) from staging_participant_private.staging_participant_synthetic_citizen_adoptions) <> 1 then
   raise exception 'Missing accepted v1 witness';
 end if;
end;
$preserved$;

\getenv participant_rpc_secret PARTICIPANT_RPC_SECRET
begin;
set local role anon;
select set_config('request.headers',jsonb_build_object('x-staging-participant-rpc-secret', :'participant_rpc_secret')::text,true) as headers_configured
\gset
select public.staging_participant_gateway_read_public_synthetic_adoption(
  'roebel-mueritz',repeat('5',64),repeat('3',64)) =
 public.staging_participant_gateway_resolve_synthetic_adoption_replay(
  'roebel-mueritz','30000000-0000-4000-8000-000000000004',repeat('c',64),repeat('a',64),repeat('7',64))
 as old_projection_and_exact_replay_preserved
\gset
\if :old_projection_and_exact_replay_preserved
\else
  \echo 'Old public projection or exact replay was lost during rotation.'
  \quit 1
\endif
rollback;
\unset participant_rpc_secret
\echo 'Identity rotation preserved old challenge, adoption, exact replay and normal post rows.'
