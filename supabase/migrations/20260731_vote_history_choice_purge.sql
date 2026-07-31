-- vote_history exists to answer ONE question: how many proposals a wallet has
-- participated in (profile stat + claim-reward existence check). It also stored
-- the plaintext CHOICE (vote_type 0/1/2) under an open SELECT policy — the exact
-- information MACI encrypts on-chain at real cost, and the leak the 2026-07-09
-- ZK assessment said to fix first. Participation may be public; the choice must
-- not be (EDPB Guidelines 02/2025; political-opinion proximity, Art. 9 DSGVO).
--
-- ORDER MATTERS: apply this BEFORE shipping the client change that stops
-- sending vote_type (apps/expo/lib/supabase-votes.ts + the web route). Until
-- the column is nullable, inserts without it would fail.

alter table public.vote_history alter column vote_type drop not null;
alter table public.vote_history alter column vote_type set default null;

-- Erase every historical choice. Row count — the participation stat — is untouched.
update public.vote_history set vote_type = null where vote_type is not null;

-- VERIFY ON APPLY (function source lives only in the database, not this repo):
-- if record_vote() validates or requires p_vote_type, CREATE OR REPLACE it to
-- accept and discard NULL — the web route now always sends null.
