\set ON_ERROR_STOP on
\getenv authenticator_password AUTHENTICATOR_PASSWORD
\getenv participant_environment_arm PARTICIPANT_ENVIRONMENT_ARM
\getenv participant_rpc_secret PARTICIPANT_RPC_SECRET

select
  length(:'authenticator_password') >= 32
  and :'participant_environment_arm' = 'staging-only'
  and length(:'participant_rpc_secret') >= 32 as provisioning_inputs_valid
\gset
\if :provisioning_inputs_valid
\else
  \echo 'Ephemeral participant Vault inputs are invalid.'
  \quit 1
\endif

-- Discard Vault UUIDs as well as command status. Neither input value is
-- emitted by this session or passed as a psql command-line argument.
\o /dev/null
alter role authenticator with login password :'authenticator_password';
select vault.create_secret(
  :'participant_environment_arm',
  'roebel_staging_participant_environment_arm'
);
select vault.create_secret(
  :'participant_rpc_secret',
  'roebel_staging_participant_rpc_secret'
);
\o

\unset authenticator_password
\unset participant_environment_arm
\unset participant_rpc_secret
