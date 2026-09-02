\set ON_ERROR_STOP on
\getenv participant_rpc_secret PARTICIPANT_RPC_SECRET

select length(:'participant_rpc_secret') >= 32 as rpc_secret_valid
\gset
\if :rpc_secret_valid
\else
  \echo 'Ephemeral participant RPC secret is invalid.'
  \quit 1
\endif

\set participant_wallet '0x1111111111111111111111111111111111111111'
\set municipality_id 'roebel-mueritz'
\set namespace 'urn:stadtstack:topic:municipality:roebel-mueritz'
\set topic_id 'urn:stadtstack:topic:municipality:roebel-mueritz:synthetischer-treffpunkt'
\set participant_suggestion_id '5555555555555555555555555555555555555555555555555555555555555555'
\set participant_pubkey 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
\set adopter_pubkey '3333333333333333333333333333333333333333333333333333333333333333'
\set challenge_id '11111111111111111111111111111111'
\set session_binding_sha256 '2222222222222222222222222222222222222222222222222222222222222222'
\set policy_version 'roebel-gnosis-staging-test-v1'
\set test_citizen_nft '0x0be374808a567c9088ac8208b90a4239432b3220'
\set proof_event_id '7777777777777777777777777777777777777777777777777777777777777777'
\set tracer_id 'urn:stadtstack:synthetic-citizen-adoption-tracer:9999999999999999999999999999999999999999999999999999999999999999'
\set request_id '30000000-0000-4000-8000-000000000004'
\set idempotency_sha256 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
\set request_checksum 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

select extract(epoch from clock_timestamp())::bigint as issued_at
\gset
select (:'issued_at'::bigint + 1)::text as consumed_at,
       (:'issued_at'::bigint + 2)::text as received_at,
       (:'issued_at'::bigint + 300)::text as expires_at
\gset

select jsonb_build_object(
  'schemaVersion', 'staging_test_citizen_pass_v1',
  'challengeId', :'challenge_id',
  'audience', 'roebel-staging-synthetic-citizen-adoption',
  'chainId', 100,
  'testCitizenNftContract', :'test_citizen_nft',
  'subjectPubkey', :'adopter_pubkey',
  'municipalityId', :'municipality_id',
  'policyVersion', :'policy_version',
  'participantSuggestionId', :'participant_suggestion_id',
  'topicId', :'topic_id',
  'issuedAt', :'issued_at'::bigint,
  'expiresAt', :'expires_at'::bigint,
  'environment', 'staging',
  'testOnly', true,
  'authorityBinding', 'none'
)::text as canonical_challenge
\gset

select (:'canonical_challenge'::jsonb || jsonb_build_object(
  'canonicalChallenge', :'canonical_challenge',
  'message', :'canonical_challenge'
))::text as challenge_json
\gset

select jsonb_build_object(
  'id', :'proof_event_id',
  'pubkey', :'adopter_pubkey',
  'created_at', :'issued_at'::bigint,
  'kind', 1,
  'tags', jsonb_build_array(
    jsonb_build_array('schema', 'staging_test_citizen_pass_proof_v1'),
    jsonb_build_array('challenge', :'challenge_id'),
    jsonb_build_array(
      'e', :'participant_suggestion_id', '', 'synthetic-adoption-test'
    ),
    jsonb_build_array('municipality', :'municipality_id'),
    jsonb_build_array('test-only', 'true')
  ),
  'content', :'canonical_challenge',
  'sig', repeat('8', 128)
)::text as proof_event_json,
jsonb_build_object(
  'active', true,
  'chainId', 100,
  'contractAddress', :'test_citizen_nft',
  'finalizedBlockNumber', '48044318',
  'finalizedBlockHash', '0x' || repeat('c', 64)
)::text as private_eligibility_evidence_json
\gset

select jsonb_build_object(
  'schemaVersion', 'synthetic_citizen_adoption_tracer_v1',
  'tracerId', :'tracer_id',
  'municipalityId', :'municipality_id',
  'topicId', :'topic_id',
  'participantSuggestionId', :'participant_suggestion_id',
  'participantSuggestionRef', 'nostr://event/' || :'participant_suggestion_id',
  'participantPubkey', :'participant_pubkey',
  'sourceDiscussionId', repeat('d', 64),
  'sourceAnswerReceiptId', 'urn:stadtstack:mecky-answer:' || repeat('f', 64),
  'adopterPubkey', :'adopter_pubkey',
  'proofEventId', :'proof_event_id',
  'title', 'Treffpunkt synthetisch prüfen',
  'summary', 'Nur die technische Fortsetzung wird ohne Bürger- oder Verwaltungswirkung gezeigt.',
  'entryState', 'synthetic_journey_preview_only',
  'environment', 'staging',
  'testOnly', true,
  'authorityBinding', 'none',
  'submittedToCivicWorkflow', false
)::text as tracer_json,
jsonb_build_object(
  'schemaVersion', 'synthetic_citizen_adoption_tracer_acceptance_v1',
  'tracerId', :'tracer_id',
  'proofEventId', :'proof_event_id',
  'municipalityId', :'municipality_id',
  'topicId', :'topic_id',
  'participantSuggestionId', :'participant_suggestion_id',
  'adopterPubkey', :'adopter_pubkey',
  'requestChecksum', :'request_checksum',
  'eventCreatedAt', :'issued_at'::bigint,
  'receivedAt', :'received_at'::bigint,
  'policyVersion', :'policy_version',
  'status', 'accepted_for_synthetic_preview',
  'environment', 'staging',
  'testOnly', true,
  'authorityBinding', 'none',
  'receiptChecksum', repeat('b', 64)
)::text as acceptance_json
\gset

select jsonb_build_object(
  'schemaVersion', 'public_synthetic_citizen_adoption_projection_v1',
  'participantSuggestionId', :'participant_suggestion_id',
  'proofEvent', :'proof_event_json'::jsonb,
  'tracer', :'tracer_json'::jsonb,
  'acceptanceReceipt', :'acceptance_json'::jsonb,
  'labels', jsonb_build_object(
    'citizenship', 'Test-Bürger-Pass – keine reale Bürgerberechtigung',
    'civicWorkflow',
      'Nur synthetische Vorschau – kein CivicCase und keine Verwaltungsbefürwortung',
    'governance',
      'Keine bindende Abstimmung, kein Beschluss, keine Treasury-Wirkung und keine Zahlung'
  ),
  'entryState', 'synthetic_journey_preview_only',
  'environment', 'staging',
  'testOnly', true,
  'authorityBinding', 'none',
  'submittedToCivicWorkflow', false,
  'civicCaseCreated', false,
  'administrativeEndorsement', false,
  'bindingVote', false,
  'councilDecision', false,
  'treasuryEffect', false,
  'paymentEffect', false
)::text as projection_json
\gset

begin;

insert into staging_participant_private.staging_participant_admissions (
  wallet_address, expires_at
) values (
  :'participant_wallet', clock_timestamp() + interval '90 minutes'
);

insert into staging_participant_private.staging_participant_topic_suggestions (
  namespace, wallet_address, discussion_root_id, source_author_pubkey,
  request_id, idempotency_key_sha256, suggestion_id, suggestion_sha256,
  mecky_answer_id, mecky_receipt_id, topic_id, policy_version, state,
  receipt_checksum, published_at
) values (
  :'namespace', :'participant_wallet', repeat('d', 64), :'participant_pubkey',
  '30000000-0000-4000-8000-000000000001'::uuid,
  decode(repeat('1', 64), 'hex'), :'participant_suggestion_id',
  decode(repeat('5', 64), 'hex'), repeat('f', 64),
  'urn:stadtstack:mecky-answer:' || repeat('f', 64), :'topic_id',
  :'policy_version', 'published', decode(repeat('2', 64), 'hex'),
  clock_timestamp()
);

set local role anon;
select set_config(
  'request.headers',
  jsonb_build_object(
    'x-staging-participant-rpc-secret', :'participant_rpc_secret'
  )::text,
  true
) as request_header_configured
\gset

select public.staging_participant_gateway_synthetic_adoption_preflight() =
  jsonb_build_object(
    'migration_id', '20260902_staging_synthetic_citizen_adoption',
    'database_schema_sha256',
      'sha256:bcaa0b098a99b145e5111c17e29e5e7d9e9eb0840ee27643b3c26db34118bd66'
  ) as synthetic_preflight_exact
\gset
\if :synthetic_preflight_exact
\else
  \echo 'Synthetic citizen-adoption preflight was not checksum exact.'
  \quit 1
\endif

select public.staging_participant_gateway_issue_synthetic_challenge(
  :'challenge_json'::jsonb, :'participant_wallet', :'session_binding_sha256'
) = :'challenge_json'::jsonb as synthetic_challenge_issued_exactly
\gset
\if :synthetic_challenge_issued_exactly
\else
  \echo 'Synthetic challenge issue did not return the exact challenge.'
  \quit 1
\endif

select public.staging_participant_gateway_issue_synthetic_challenge(
  :'challenge_json'::jsonb, :'participant_wallet', :'session_binding_sha256'
) = :'challenge_json'::jsonb as synthetic_challenge_issue_retry_exact
\gset
\if :synthetic_challenge_issue_retry_exact
\else
  \echo 'Synthetic challenge issue retry was not idempotent.'
  \quit 1
\endif

select public.staging_participant_gateway_consume_synthetic_challenge(
  :'challenge_id', :'participant_wallet', :'session_binding_sha256',
  :'consumed_at'::bigint
) = :'challenge_json'::jsonb as synthetic_challenge_consumed_exactly
\gset
\if :synthetic_challenge_consumed_exactly
\else
  \echo 'Synthetic challenge consume did not return the exact challenge.'
  \quit 1
\endif

do $synthetic_challenge_used$
declare
  failure_message text;
begin
  perform public.staging_participant_gateway_consume_synthetic_challenge(
    '11111111111111111111111111111111',
    '0x1111111111111111111111111111111111111111',
    '2222222222222222222222222222222222222222222222222222222222222222',
    extract(epoch from clock_timestamp())::bigint
  );
  raise exception 'Expected STAGING_PARTICIPANT_SYNTHETIC_CHALLENGE_USED';
exception when sqlstate 'P0001' then
  get stacked diagnostics failure_message = message_text;
  if failure_message <> 'STAGING_PARTICIPANT_SYNTHETIC_CHALLENGE_USED' then
    raise exception 'Second synthetic challenge consume returned %', failure_message
      using errcode = 'XX000';
  end if;
end;
$synthetic_challenge_used$;

select public.staging_participant_gateway_accept_synthetic_adoption(
  :'municipality_id', :'request_id'::uuid, :'idempotency_sha256',
  :'request_checksum', :'received_at'::bigint, 300,
  :'proof_event_json'::jsonb, :'private_eligibility_evidence_json'::jsonb,
  :'projection_json'::jsonb
) = :'projection_json'::jsonb as synthetic_adoption_accepted_exactly
\gset
\if :synthetic_adoption_accepted_exactly
\else
  \echo 'Synthetic adoption did not return the exact public projection.'
  \quit 1
\endif

select (
  public.staging_participant_gateway_accept_synthetic_adoption(
    :'municipality_id', :'request_id'::uuid, :'idempotency_sha256',
    :'request_checksum', :'received_at'::bigint, 300,
    :'proof_event_json'::jsonb, :'private_eligibility_evidence_json'::jsonb,
    :'projection_json'::jsonb
  ) = :'projection_json'::jsonb
  and public.staging_participant_gateway_resolve_synthetic_adoption_replay(
    :'municipality_id', :'request_id'::uuid, :'idempotency_sha256',
    :'request_checksum', :'proof_event_id'
  ) = :'projection_json'::jsonb
) as synthetic_adoption_exact_retry
\gset
\if :synthetic_adoption_exact_retry
\else
  \echo 'Synthetic adoption exact retry/replay did not return the original.'
  \quit 1
\endif

select jsonb_set(
  :'projection_json'::jsonb,
  '{acceptanceReceipt,requestChecksum}',
  to_jsonb(repeat('d', 64))
)::text as request_conflict_projection_json,
jsonb_set(
  jsonb_set(
    jsonb_set(
      :'projection_json'::jsonb,
      '{proofEvent,id}', to_jsonb(repeat('8', 64))
    ),
    '{tracer,proofEventId}', to_jsonb(repeat('8', 64))
  ),
  '{acceptanceReceipt,proofEventId}', to_jsonb(repeat('8', 64))
)::text as event_conflict_projection_json,
jsonb_set(
  :'proof_event_json'::jsonb, '{id}', to_jsonb(repeat('8', 64))
)::text as event_conflict_proof_json
\gset

select jsonb_set(
  :'event_conflict_projection_json'::jsonb,
  '{acceptanceReceipt,requestChecksum}',
  to_jsonb(repeat('e', 64))
)::text as tuple_conflict_projection_json
\gset

do $synthetic_adoption_request_conflict$
declare
  failure_message text;
begin
  perform public.staging_participant_gateway_accept_synthetic_adoption(
    'roebel-mueritz', '30000000-0000-4000-8000-000000000004'::uuid,
    repeat('c', 64), repeat('d', 64), :'received_at'::bigint, 300,
    :'proof_event_json'::jsonb, :'private_eligibility_evidence_json'::jsonb,
    :'request_conflict_projection_json'::jsonb
  );
  raise exception 'Expected STAGING_PARTICIPANT_SYNTHETIC_ADOPTION_REQUEST_CONFLICT';
exception when sqlstate 'P0001' then
  get stacked diagnostics failure_message = message_text;
  if failure_message <> 'STAGING_PARTICIPANT_SYNTHETIC_ADOPTION_REQUEST_CONFLICT' then
    raise exception 'Synthetic request conflict returned %', failure_message
      using errcode = 'XX000';
  end if;
end;
$synthetic_adoption_request_conflict$;

do $synthetic_adoption_idempotency_conflict$
declare
  failure_message text;
begin
  perform public.staging_participant_gateway_accept_synthetic_adoption(
    'roebel-mueritz', '30000000-0000-4000-8000-000000000004'::uuid,
    repeat('6', 64), repeat('a', 64), :'received_at'::bigint, 300,
    :'proof_event_json'::jsonb, :'private_eligibility_evidence_json'::jsonb,
    :'projection_json'::jsonb
  );
  raise exception 'Expected STAGING_PARTICIPANT_SYNTHETIC_ADOPTION_IDEMPOTENCY_CONFLICT';
exception when sqlstate 'P0001' then
  get stacked diagnostics failure_message = message_text;
  if failure_message <> 'STAGING_PARTICIPANT_SYNTHETIC_ADOPTION_IDEMPOTENCY_CONFLICT' then
    raise exception 'Synthetic idempotency conflict returned %', failure_message
      using errcode = 'XX000';
  end if;
end;
$synthetic_adoption_idempotency_conflict$;

do $synthetic_adoption_event_conflict$
declare
  failure_message text;
begin
  perform public.staging_participant_gateway_accept_synthetic_adoption(
    'roebel-mueritz', '30000000-0000-4000-8000-000000000004'::uuid,
    repeat('c', 64), repeat('a', 64), :'received_at'::bigint, 300,
    :'event_conflict_proof_json'::jsonb,
    :'private_eligibility_evidence_json'::jsonb,
    :'event_conflict_projection_json'::jsonb
  );
  raise exception 'Expected STAGING_PARTICIPANT_SYNTHETIC_ADOPTION_EVENT_CONFLICT';
exception when sqlstate 'P0001' then
  get stacked diagnostics failure_message = message_text;
  if failure_message <> 'STAGING_PARTICIPANT_SYNTHETIC_ADOPTION_EVENT_CONFLICT' then
    raise exception 'Synthetic event conflict returned %', failure_message
      using errcode = 'XX000';
  end if;
end;
$synthetic_adoption_event_conflict$;

do $synthetic_adoption_tuple_conflict$
declare
  failure_message text;
begin
  perform public.staging_participant_gateway_accept_synthetic_adoption(
    'roebel-mueritz', '30000000-0000-4000-8000-000000000005'::uuid,
    repeat('7', 64), repeat('e', 64), :'received_at'::bigint, 300,
    :'event_conflict_proof_json'::jsonb,
    :'private_eligibility_evidence_json'::jsonb,
    :'tuple_conflict_projection_json'::jsonb
  );
  raise exception 'Expected STAGING_PARTICIPANT_SYNTHETIC_ADOPTION_TUPLE_CONFLICT';
exception when sqlstate 'P0001' then
  get stacked diagnostics failure_message = message_text;
  if failure_message <> 'STAGING_PARTICIPANT_SYNTHETIC_ADOPTION_TUPLE_CONFLICT' then
    raise exception 'Synthetic tuple conflict returned %', failure_message
      using errcode = 'XX000';
  end if;
end;
$synthetic_adoption_tuple_conflict$;

reset role;

select (
  count(*) = 1
  and bool_and(wallet_address = :'participant_wallet')
  and bool_and(private_eligibility_evidence =
    :'private_eligibility_evidence_json'::jsonb)
  and bool_and(public_projection::text not like '%' || wallet_address || '%')
  and bool_and(public_projection::text not like '%walletAddress%')
  and bool_and(public_projection::text not like '%sessionBindingSha256%')
  and bool_and(public_projection::text not like '%privateEligibilityEvidence%')
  and bool_and(public_projection::text not like '%finalizedBlockNumber%')
  and bool_and(public_projection::text not like '%finalizedBlockHash%')
) as synthetic_private_evidence_isolated
  from staging_participant_private.staging_participant_synthetic_citizen_adoptions
\gset
\if :synthetic_private_evidence_isolated
\else
  \echo 'Synthetic private eligibility evidence leaked or was not retained.'
  \quit 1
\endif

select (
  not has_table_privilege(
    'anon',
    'staging_participant_private.staging_participant_synthetic_citizen_challenges',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'authenticated',
    'staging_participant_private.staging_participant_synthetic_citizen_adoptions',
    'SELECT,INSERT,UPDATE,DELETE'
  )
) as synthetic_private_tables_are_acl_closed
\gset
\if :synthetic_private_tables_are_acl_closed
\else
  \echo 'Synthetic private tables exposed a direct application-role ACL.'
  \quit 1
\endif

set local role anon;
select (
  public.staging_participant_gateway_read_public_synthetic_adoption(
    :'municipality_id', :'participant_suggestion_id', :'adopter_pubkey'
  ) = :'projection_json'::jsonb
  and :'projection_json'::jsonb->>'entryState' =
    'synthetic_journey_preview_only'
  and :'projection_json'::jsonb->>'environment' = 'staging'
  and :'projection_json'::jsonb->'testOnly' = 'true'::jsonb
  and :'projection_json'::jsonb->>'authorityBinding' = 'none'
  and :'projection_json'::jsonb->'submittedToCivicWorkflow' = 'false'::jsonb
  and :'projection_json'::jsonb->'civicCaseCreated' = 'false'::jsonb
  and :'projection_json'::jsonb->'administrativeEndorsement' = 'false'::jsonb
  and :'projection_json'::jsonb->'bindingVote' = 'false'::jsonb
  and :'projection_json'::jsonb->'councilDecision' = 'false'::jsonb
  and :'projection_json'::jsonb->'treasuryEffect' = 'false'::jsonb
  and :'projection_json'::jsonb->'paymentEffect' = 'false'::jsonb
) as synthetic_public_projection_has_no_authority
\gset
\if :synthetic_public_projection_has_no_authority
\else
  \echo 'Synthetic public projection crossed its no-authority boundary.'
  \quit 1
\endif

rollback;
\unset participant_rpc_secret
\echo 'Synthetic citizen-adoption database behavior checks passed.'
