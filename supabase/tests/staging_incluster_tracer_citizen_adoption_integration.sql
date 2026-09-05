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
\set topic_id 'urn:stadtstack:topic:municipality:roebel-mueritz:offener-treffpunkt'
\set participant_suggestion_id '4444444444444444444444444444444444444444444444444444444444444444'
\set subject_pubkey '3333333333333333333333333333333333333333333333333333333333333333'
\set challenge_id '11111111111111111111111111111111'
\set session_binding_sha256 '2222222222222222222222222222222222222222222222222222222222222222'
\set policy_version 'roebel-citizen-nft-v2-staging-2026-09'
\set receipt_checksum '6666666666666666666666666666666666666666666666666666666666666666'
\set receipt_id 'urn:stadtstack:municipal-civic-eligibility-receipt:6666666666666666666666666666666666666666666666666666666666666666'
\set adoption_id 'urn:stadtstack:citizen-topic-suggestion-adoption:9999999999999999999999999999999999999999999999999999999999999999'
\set adoption_event_id '7777777777777777777777777777777777777777777777777777777777777777'
\set adoption_request_id '20000000-0000-4000-8000-000000000004'
\set adoption_idempotency_sha256 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
\set adoption_request_checksum 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

select extract(epoch from clock_timestamp())::bigint as issued_at
\gset
select (:'issued_at'::bigint + 10)::text as consumed_at,
       (:'issued_at'::bigint + 300)::text as challenge_expires_at,
       (:'issued_at'::bigint + 910)::text as receipt_expires_at,
       (:'issued_at'::bigint + 20)::text as adoption_event_created_at,
       (:'issued_at'::bigint + 21)::text as adoption_received_at
\gset

select jsonb_build_object(
  'schemaVersion', 'municipal_civic_eligibility_challenge_v1',
  'challengeId', :'challenge_id',
  'audience', 'roebel-staging-citizen-adoption',
  'sessionBindingSha256', :'session_binding_sha256',
  'walletAddress', :'participant_wallet',
  'chainId', 100,
  'subjectPubkey', :'subject_pubkey',
  'municipalityId', :'municipality_id',
  'policyVersion', :'policy_version',
  'participantSuggestionId', :'participant_suggestion_id',
  'topicId', :'topic_id',
  'issuedAt', :'issued_at'::bigint,
  'expiresAt', :'challenge_expires_at'::bigint,
  'authorityBinding', 'civic_eligibility_only',
  'canonicalChallenge', '{"closed":true}',
  'message', '{"closed":true}'
)::text as challenge_json
\gset

select jsonb_build_object(
  'schemaVersion', 'municipal_civic_eligibility_receipt_v1',
  'eligibilityCore', jsonb_build_object(
    'municipalityId', :'municipality_id',
    'eligibilityClass', 'municipal_civic_participation',
    'subjectPubkey', :'subject_pubkey',
    'participantSuggestionId', :'participant_suggestion_id',
    'topicId', :'topic_id',
    'policyVersion', :'policy_version',
    'issuer', 'roebel-staging-citizen-verifier',
    'issuedAt', :'consumed_at'::bigint,
    'expiresAt', :'receipt_expires_at'::bigint,
    'authorityBinding', 'civic_eligibility_only'
  ),
  'receiptId', :'receipt_id',
  'payloadChecksum', :'receipt_checksum',
  'statusRef', 'https://roebel-web.staging.agentcart.eu/api/civic/v1/eligibility/status/' || :'receipt_checksum',
  'proof', jsonb_build_object(
    'algorithm', 'Ed25519',
    'keyId', 'roebel-staging-eligibility-issuer-2026-09',
    'signature', repeat('A', 86)
  )
)::text as eligibility_receipt_json,
jsonb_build_object(
  'active', true,
  'chainId', 100,
  'contractAddress', '0x59aa26f499d7c2b3ec2c8524ed06f54fc4e85de5',
  'finalizedBlockNumber', '12345',
  'finalizedBlockHash', '0x' || repeat('8', 64)
)::text as private_eligibility_evidence_json
\gset

select jsonb_build_object(
  'schemaVersion', 'public_citizen_topic_suggestion_adoption_v1',
  'adoptionId', :'adoption_id',
  'municipalityId', :'municipality_id',
  'topicId', :'topic_id',
  'participantSuggestionId', :'participant_suggestion_id',
  'participantSuggestionRef', 'nostr://event/' || :'participant_suggestion_id',
  'participantPubkey', repeat('e', 64),
  'sourceDiscussionId', repeat('d', 64),
  'sourceAnswerReceiptId', 'urn:stadtstack:mecky-answer:' || repeat('a', 64),
  'adopterPubkey', :'subject_pubkey',
  'eligibilityReceiptId', :'receipt_id',
  'eligibilityReceiptChecksum', :'receipt_checksum',
  'title', 'Treffpunkt prüfen',
  'summary', 'Die Optionen sollen menschlich geprüft werden.',
  'entryState', 'case_steward_review_required',
  'authorityBinding', 'civic_eligibility_only',
  'submittedToCivicWorkflow', false
)::text as public_adoption_json
\gset

select jsonb_build_object(
  'id', :'adoption_event_id',
  'pubkey', :'subject_pubkey',
  'created_at', :'adoption_event_created_at'::bigint,
  'kind', 1,
  'tags', jsonb_build_array(
    jsonb_build_array('schema', 'citizen_adopted_topic_suggestion_v1'),
    jsonb_build_array('municipality', :'municipality_id'),
    jsonb_build_array('topic', :'topic_id'),
    jsonb_build_array(
      'e', :'participant_suggestion_id', '', 'adopted-suggestion'
    ),
    jsonb_build_array('e', repeat('d', 64), '', 'root'),
    jsonb_build_array('p', repeat('e', 64)),
    jsonb_build_array('eligibility-receipt', :'receipt_id'),
    jsonb_build_array('credential-class', 'municipal-civic-eligibility')
  ),
  'content', :'public_adoption_json',
  'sig', repeat('8', 128)
)::text as adoption_event_json
\gset

select jsonb_build_object(
  'schemaVersion', 'citizen_adopted_topic_suggestion_v1',
  'adoptionId', :'adoption_id',
  'signerPubkey', :'subject_pubkey',
  'participantSuggestionId', :'participant_suggestion_id',
  'eligibilityReceiptId', :'receipt_id',
  'adoption', :'public_adoption_json'::jsonb,
  'event', :'adoption_event_json'::jsonb,
  'verification', jsonb_build_object('kind', 'nostr_nip01', 'verified', true),
  'entryState', 'case_steward_review_required',
  'authorityBinding', 'civic_eligibility_only',
  'submittedToCivicWorkflow', false
)::text as adoption_json,
jsonb_build_object(
  'schemaVersion', 'citizen_topic_suggestion_adoption_acceptance_receipt_v1',
  'adoptionId', :'adoption_id',
  'adoptionEventId', :'adoption_event_id',
  'municipalityId', :'municipality_id',
  'topicId', :'topic_id',
  'participantSuggestionId', :'participant_suggestion_id',
  'adopterPubkey', :'subject_pubkey',
  'eligibilityReceiptId', :'receipt_id',
  'requestChecksum', :'adoption_request_checksum',
  'eventCreatedAt', :'adoption_event_created_at'::bigint,
  'receivedAt', :'adoption_received_at'::bigint,
  'policyVersion', :'policy_version',
  'status', 'accepted',
  'authorityBinding', 'civic_eligibility_only',
  'receiptChecksum', repeat('b', 64)
)::text as adoption_acceptance_receipt_json
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
  :'namespace', :'participant_wallet', repeat('d', 64), repeat('e', 64),
  '10000000-0000-4000-8000-000000000001'::uuid, decode(repeat('a', 64), 'hex'),
  :'participant_suggestion_id', decode(repeat('4', 64), 'hex'),
  repeat('f', 64), 'urn:stadtstack:mecky-answer:' || repeat('a', 64),
  :'topic_id', :'policy_version', 'published', decode(repeat('b', 64), 'hex'),
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

select public.staging_participant_gateway_issue_citizen_challenge(
  :'challenge_json'::jsonb
) = :'challenge_json'::jsonb as challenge_issued_exactly
\gset
\if :challenge_issued_exactly
\else
  \echo 'Citizen challenge issue did not return the exact challenge.'
  \quit 1
\endif

select public.staging_participant_gateway_consume_citizen_challenge(
  :'challenge_id', :'participant_wallet', :'session_binding_sha256',
  :'consumed_at'::bigint
) = :'challenge_json'::jsonb as challenge_consumed_exactly
\gset
\if :challenge_consumed_exactly
\else
  \echo 'Citizen challenge consume did not return the exact challenge.'
  \quit 1
\endif

do $citizen_challenge_used$
declare
  failure_message text;
begin
  perform public.staging_participant_gateway_consume_citizen_challenge(
    '11111111111111111111111111111111',
    '0x1111111111111111111111111111111111111111',
    '2222222222222222222222222222222222222222222222222222222222222222',
    extract(epoch from clock_timestamp())::bigint
  );
  raise exception 'Expected STAGING_PARTICIPANT_CITIZEN_CHALLENGE_USED';
exception when sqlstate 'P0001' then
  get stacked diagnostics failure_message = message_text;
  if failure_message <> 'STAGING_PARTICIPANT_CITIZEN_CHALLENGE_USED' then
    raise exception 'Second challenge consume returned %', failure_message
      using errcode = 'XX000';
  end if;
end;
$citizen_challenge_used$;

select public.staging_participant_gateway_store_citizen_eligibility_receipt(
  :'challenge_id',
  :'eligibility_receipt_json'::jsonb,
  :'private_eligibility_evidence_json'::jsonb
) = :'eligibility_receipt_json'::jsonb as eligibility_receipt_stored_exactly
\gset
\if :eligibility_receipt_stored_exactly
\else
  \echo 'Citizen eligibility receipt store did not return its public receipt.'
  \quit 1
\endif

select (
  public.staging_participant_gateway_get_citizen_eligibility_receipt(
    :'receipt_id'
  ) = :'eligibility_receipt_json'::jsonb
  and not public.staging_participant_gateway_get_citizen_eligibility_receipt(
    :'receipt_id'
  ) ? 'privateEligibilityEvidence'
  and public.staging_participant_gateway_get_citizen_eligibility_receipt(
    :'receipt_id'
  )::text not like '%finalizedBlock%'
) as eligibility_receipt_public_read_exact
\gset
\if :eligibility_receipt_public_read_exact
\else
  \echo 'Citizen eligibility receipt public read leaked or drifted.'
  \quit 1
\endif

-- The status reader gets exactly one private holder binding. The public
-- receipt reader above and the adoption projection below stay wallet-free.
select public.staging_participant_gateway_get_citizen_status_holder(
  :'receipt_id', :'municipality_id', :'policy_version'
) = jsonb_build_object(
  'receipt', :'eligibility_receipt_json'::jsonb,
  'walletAddress', :'participant_wallet'
) and public.staging_participant_gateway_get_citizen_status_holder(
  :'receipt_id', 'strausberg', :'policy_version'
) is null and public.staging_participant_gateway_get_citizen_status_holder(
  :'receipt_id', :'municipality_id', 'different-policy'
) is null and public.staging_participant_gateway_get_citizen_status_holder(
  'urn:stadtstack:municipal-civic-eligibility-receipt:' || repeat('f', 64),
  :'municipality_id', :'policy_version'
) is null as status_holder_exact_and_scoped
\gset
\if :status_holder_exact_and_scoped
\else
  \echo 'Status holder lookup drifted or disclosed another scope.'
  \quit 1
\endif

do $status_request_and_permissions$
declare v_id text;
begin
  foreach v_id in array array[null, '', 'not-a-receipt'] loop
    begin
      perform public.staging_participant_gateway_get_citizen_status_holder(
        v_id, 'roebel-mueritz', 'roebel-citizen-nft-v2-staging-2026-09'
      );
      raise exception 'Malformed status lookup succeeded' using errcode = 'XX000';
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'STAGING_PARTICIPANT_CITIZEN_STATUS_LOOKUP_INVALID' then raise; end if;
    end;
  end loop;
  begin
    perform wallet_address from staging_participant_private.staging_participant_citizen_eligibility_challenges;
    raise exception 'Anon read a private holder table' using errcode = 'XX000';
  exception when insufficient_privilege then null;
  end;
  begin
    perform set_config('request.headers', '{}', true);
    perform public.staging_participant_gateway_get_citizen_status_holder(
      'urn:stadtstack:municipal-civic-eligibility-receipt:' || repeat('6', 64),
      'roebel-mueritz', 'roebel-citizen-nft-v2-staging-2026-09'
    );
    raise exception 'Status lookup without capability succeeded' using errcode = 'XX000';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'STAGING_PARTICIPANT_GATEWAY_REQUIRED' then raise; end if;
    -- The exception subtransaction restores request.headers.
  end;
end;
$status_request_and_permissions$;

reset role;
set local role authenticated;
do $status_authenticated_denied$
begin
  perform public.staging_participant_gateway_get_citizen_status_holder(
    'urn:stadtstack:municipal-civic-eligibility-receipt:' || repeat('6', 64),
    'roebel-mueritz', 'roebel-citizen-nft-v2-staging-2026-09'
  );
  raise exception 'Authenticated role executed the private lookup' using errcode = 'XX000';
exception when insufficient_privilege then null;
end;
$status_authenticated_denied$;
reset role;

do $status_catalog_and_binding$
declare
  v_function regprocedure := 'public.staging_participant_gateway_get_citizen_status_holder(text,text,text)'::regprocedure;
  v_change text;
begin
  if not exists (
    select 1 from pg_proc where oid = v_function
      and prosecdef and provolatile = 's'
      and proconfig = array['search_path=pg_catalog, staging_participant_private']
  ) or exists (
    select 1 from pg_proc p,
      lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
     where p.oid = v_function and acl.grantee <> p.proowner
       and (acl.grantee <> 'anon'::regrole or acl.privilege_type <> 'EXECUTE' or acl.is_grantable)
  ) then
    raise exception 'Status lookup catalog or permissions drifted' using errcode = 'XX000';
  end if;

  -- Privileged fixture corruption must fail closed. Each caught exception
  -- rolls back its mutation, leaving the original receipt/challenge intact.
  foreach v_change in array array[
    'consumed', 'wallet', 'challenge-id', 'municipality', 'policy',
    'subject', 'suggestion', 'topic', 'public-id', 'public-subject'
  ] loop
    begin
      case v_change
        when 'consumed' then
          update staging_participant_private.staging_participant_citizen_eligibility_challenges set consumed_at = null;
        when 'wallet' then
          update staging_participant_private.staging_participant_citizen_eligibility_challenges set wallet_address = '0x' || repeat('f', 40);
        when 'challenge-id' then
          update staging_participant_private.staging_participant_citizen_eligibility_challenges set challenge = jsonb_set(challenge, '{challengeId}', to_jsonb(repeat('f', 32)));
        when 'municipality' then
          update staging_participant_private.staging_participant_citizen_eligibility_challenges set municipality_id = 'strausberg', topic_id = 'urn:stadtstack:topic:municipality:strausberg:example';
        when 'policy' then
          update staging_participant_private.staging_participant_citizen_eligibility_challenges set policy_version = 'different-policy';
        when 'subject' then
          update staging_participant_private.staging_participant_citizen_eligibility_challenges set subject_pubkey = repeat('f', 64);
        when 'suggestion' then
          update staging_participant_private.staging_participant_citizen_eligibility_challenges set participant_suggestion_id = repeat('f', 64);
        when 'topic' then
          update staging_participant_private.staging_participant_citizen_eligibility_challenges set topic_id = 'urn:stadtstack:topic:municipality:roebel-mueritz:other';
        when 'public-id' then
          update staging_participant_private.staging_participant_citizen_eligibility_receipts set public_receipt = jsonb_set(public_receipt, '{receiptId}', to_jsonb('urn:stadtstack:municipal-civic-eligibility-receipt:' || repeat('f', 64)));
        when 'public-subject' then
          update staging_participant_private.staging_participant_citizen_eligibility_receipts set public_receipt = jsonb_set(public_receipt, '{eligibilityCore,subjectPubkey}', to_jsonb(repeat('f', 64)));
      end case;
      perform public.staging_participant_gateway_get_citizen_status_holder(
        'urn:stadtstack:municipal-civic-eligibility-receipt:' || repeat('6', 64),
        'roebel-mueritz', 'roebel-citizen-nft-v2-staging-2026-09'
      );
      raise exception 'Corrupt status binding succeeded: %', v_change using errcode = 'XX000';
    exception when sqlstate 'P0001' then
      if sqlerrm <> 'STAGING_PARTICIPANT_CITIZEN_STATUS_BINDING_INVALID' then raise; end if;
    end;
  end loop;
  begin
    update public.app_settings set value = 'production' where key = 'roebel_env';
    perform public.staging_participant_gateway_get_citizen_status_holder(
      'urn:stadtstack:municipal-civic-eligibility-receipt:' || repeat('6', 64),
      'roebel-mueritz', 'roebel-citizen-nft-v2-staging-2026-09'
    );
    raise exception 'Unarmed status lookup succeeded' using errcode = 'XX000';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'STAGING_PARTICIPANT_ENVIRONMENT_REQUIRED' then raise; end if;
  end;
end;
$status_catalog_and_binding$;
set local role anon;

select public.staging_participant_gateway_get_citizen_suggestion_root(
  :'municipality_id', :'participant_suggestion_id'
) = jsonb_build_object(
  'municipality_id', :'municipality_id',
  'suggestion_id', :'participant_suggestion_id',
  'discussion_root_id', repeat('d', 64),
  'source_author_pubkey', repeat('e', 64)
) as suggestion_root_exact
\gset
\if :suggestion_root_exact
\else
  \echo 'Citizen adoption source root did not resolve exactly.'
  \quit 1
\endif

select public.staging_participant_gateway_accept_citizen_adoption(
  :'municipality_id',
  :'adoption_request_id'::uuid,
  :'adoption_idempotency_sha256',
  :'adoption_request_checksum',
  :'adoption_received_at'::bigint,
  300,
  :'adoption_json'::jsonb,
  :'eligibility_receipt_json'::jsonb,
  :'adoption_acceptance_receipt_json'::jsonb
)::text as accepted_projection_json
\gset

select (
  :'accepted_projection_json'::jsonb->>'schemaVersion' =
    'public_citizen_adoption_projection_v1'
  and :'accepted_projection_json'::jsonb->>'participantSuggestionId' =
    :'participant_suggestion_id'
) as adoption_accepted
\gset
\if :adoption_accepted
\else
  \echo 'Citizen adoption was not accepted into the advisory ledger.'
  \quit 1
\endif

-- The exact retry must return the original durable projection byte-for-byte as
-- JSONB, without creating a second advisory hand-off.
select (
  public.staging_participant_gateway_accept_citizen_adoption(
    :'municipality_id',
    :'adoption_request_id'::uuid,
    :'adoption_idempotency_sha256',
    :'adoption_request_checksum',
    :'adoption_received_at'::bigint,
    300,
    :'adoption_json'::jsonb,
    :'eligibility_receipt_json'::jsonb,
    :'adoption_acceptance_receipt_json'::jsonb
  ) = :'accepted_projection_json'::jsonb
  and public.staging_participant_gateway_resolve_citizen_adoption_replay(
    :'municipality_id',
    :'adoption_request_id'::uuid,
    :'adoption_idempotency_sha256',
    :'adoption_request_checksum',
    :'adoption_event_id'
  ) = :'accepted_projection_json'::jsonb
) as adoption_exact_retry
\gset
\if :adoption_exact_retry
\else
  \echo 'Citizen adoption exact retry did not return the original projection.'
  \quit 1
\endif

select set_config('roebel.test.citizen_adoption', :'adoption_json', true),
       set_config(
         'roebel.test.citizen_eligibility_receipt',
         :'eligibility_receipt_json',
         true
       ),
       set_config(
         'roebel.test.citizen_adoption_acceptance_receipt',
         :'adoption_acceptance_receipt_json',
         true
       ),
       set_config(
         'roebel.test.citizen_adoption_received_at',
         :'adoption_received_at',
         true
       );

do $citizen_adoption_tuple_conflict$
declare
  failure_message text;
  conflicting_adoption jsonb := jsonb_set(
    current_setting('roebel.test.citizen_adoption')::jsonb,
    '{event,id}',
    to_jsonb(repeat('8', 64))
  );
  conflicting_acceptance jsonb := jsonb_set(
    jsonb_set(
      current_setting(
        'roebel.test.citizen_adoption_acceptance_receipt'
      )::jsonb,
      '{adoptionEventId}',
      to_jsonb(repeat('8', 64))
    ),
    '{requestChecksum}',
    to_jsonb(repeat('d', 64))
  );
begin
  perform public.staging_participant_gateway_accept_citizen_adoption(
    'roebel-mueritz',
    '20000000-0000-4000-8000-000000000007'::uuid,
    repeat('f', 64),
    repeat('d', 64),
    current_setting('roebel.test.citizen_adoption_received_at')::bigint,
    300,
    conflicting_adoption,
    current_setting('roebel.test.citizen_eligibility_receipt')::jsonb,
    conflicting_acceptance
  );
  raise exception 'Expected STAGING_PARTICIPANT_CITIZEN_ADOPTION_TUPLE_CONFLICT';
exception when sqlstate 'P0001' then
  get stacked diagnostics failure_message = message_text;
  if failure_message <> 'STAGING_PARTICIPANT_CITIZEN_ADOPTION_TUPLE_CONFLICT' then
    raise exception 'Tuple conflict returned %', failure_message
      using errcode = 'XX000';
  end if;
end;
$citizen_adoption_tuple_conflict$;

do $citizen_adoption_request_conflict$
declare
  failure_message text;
  conflicting_acceptance jsonb := jsonb_set(
    current_setting(
      'roebel.test.citizen_adoption_acceptance_receipt'
    )::jsonb,
    '{requestChecksum}',
    to_jsonb(repeat('d', 64))
  );
begin
  perform public.staging_participant_gateway_accept_citizen_adoption(
    'roebel-mueritz',
    '20000000-0000-4000-8000-000000000004'::uuid,
    repeat('c', 64),
    repeat('d', 64),
    current_setting('roebel.test.citizen_adoption_received_at')::bigint,
    300,
    current_setting('roebel.test.citizen_adoption')::jsonb,
    current_setting('roebel.test.citizen_eligibility_receipt')::jsonb,
    conflicting_acceptance
  );
  raise exception 'Expected STAGING_PARTICIPANT_CITIZEN_ADOPTION_REQUEST_CONFLICT';
exception when sqlstate 'P0001' then
  get stacked diagnostics failure_message = message_text;
  if failure_message <> 'STAGING_PARTICIPANT_CITIZEN_ADOPTION_REQUEST_CONFLICT' then
    raise exception 'Request conflict returned %', failure_message
      using errcode = 'XX000';
  end if;
end;
$citizen_adoption_request_conflict$;

do $citizen_adoption_idempotency_conflict$
declare failure_message text;
begin
  perform public.staging_participant_gateway_accept_citizen_adoption(
    'roebel-mueritz',
    '20000000-0000-4000-8000-000000000005'::uuid,
    repeat('c', 64),
    repeat('a', 64),
    current_setting('roebel.test.citizen_adoption_received_at')::bigint,
    300,
    current_setting('roebel.test.citizen_adoption')::jsonb,
    current_setting('roebel.test.citizen_eligibility_receipt')::jsonb,
    current_setting('roebel.test.citizen_adoption_acceptance_receipt')::jsonb
  );
  raise exception 'Expected STAGING_PARTICIPANT_CITIZEN_ADOPTION_IDEMPOTENCY_CONFLICT';
exception when sqlstate 'P0001' then
  get stacked diagnostics failure_message = message_text;
  if failure_message <>
     'STAGING_PARTICIPANT_CITIZEN_ADOPTION_IDEMPOTENCY_CONFLICT' then
    raise exception 'Idempotency conflict returned %', failure_message
      using errcode = 'XX000';
  end if;
end;
$citizen_adoption_idempotency_conflict$;

do $citizen_adoption_event_conflict$
declare failure_message text;
begin
  perform public.staging_participant_gateway_accept_citizen_adoption(
    'roebel-mueritz',
    '20000000-0000-4000-8000-000000000006'::uuid,
    repeat('e', 64),
    repeat('a', 64),
    current_setting('roebel.test.citizen_adoption_received_at')::bigint,
    300,
    current_setting('roebel.test.citizen_adoption')::jsonb,
    current_setting('roebel.test.citizen_eligibility_receipt')::jsonb,
    current_setting('roebel.test.citizen_adoption_acceptance_receipt')::jsonb
  );
  raise exception 'Expected STAGING_PARTICIPANT_CITIZEN_ADOPTION_EVENT_CONFLICT';
exception when sqlstate 'P0001' then
  get stacked diagnostics failure_message = message_text;
  if failure_message <> 'STAGING_PARTICIPANT_CITIZEN_ADOPTION_EVENT_CONFLICT' then
    raise exception 'Event conflict returned %', failure_message
      using errcode = 'XX000';
  end if;
end;
$citizen_adoption_event_conflict$;

reset role;
select count(*) = 1 as adoption_retry_kept_one_ledger_row
  from staging_participant_private.staging_participant_citizen_adoptions
\gset
\if :adoption_retry_kept_one_ledger_row
\else
  \echo 'Citizen adoption retry or conflict created another ledger row.'
  \quit 1
\endif
set local role anon;

select (
  public.staging_participant_gateway_read_public_citizen_adoption(
    :'municipality_id', :'participant_suggestion_id', :'subject_pubkey'
  ) = :'accepted_projection_json'::jsonb
  and :'accepted_projection_json'::jsonb->'submittedToCivicWorkflow' =
    'false'::jsonb
  and :'accepted_projection_json'::jsonb->'administrativeEndorsement' =
    'false'::jsonb
  and :'accepted_projection_json'::jsonb->'bindingVote' = 'false'::jsonb
  and :'accepted_projection_json'::jsonb->'councilDecision' = 'false'::jsonb
  and :'accepted_projection_json'::jsonb->'treasuryEffect' = 'false'::jsonb
  and :'accepted_projection_json'::jsonb->'paymentEffect' = 'false'::jsonb
  and :'accepted_projection_json'::jsonb->>'entryState' =
    'case_steward_review_required'
  and :'accepted_projection_json'::jsonb->>'authorityBinding' =
    'civic_eligibility_only'
  and :'accepted_projection_json'::jsonb::text not like '%walletAddress%'
  and :'accepted_projection_json'::jsonb::text not like '%finalizedBlock%'
) as public_adoption_is_exactly_advisory
\gset
\if :public_adoption_is_exactly_advisory
\else
  \echo 'Public citizen adoption projection crossed its advisory boundary.'
  \quit 1
\endif

rollback;
\unset participant_rpc_secret
\echo 'Citizen-adoption database behavior checks passed.'
