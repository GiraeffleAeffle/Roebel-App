# Project-owned staging identity rotation

The signer for the previous test deployment could not be established, so the user chose a new dedicated project-owned Gnosis test pair instead of depending on that signer. The replacement has the immutable identity `gnosis-staging-test-v2`; `gnosis-staging-test-v1` continues to name its original addresses and historical records. The new owner's local key also derives the five test co-signers, allowing test issuance and normal join/revoke rehearsals without granting municipal, production-governance or treasury authority.

The [deployment manifest](../../contracts/governor-contract/deployments/gnosis-staging-test-v2.json) records the source, compiler settings, constructors, bytecode hashes, owner and confirmed transactions. Both migrations remain open for owner-issued test passes. The approved 0.01 xDAI budget covered deployment and five 0.0001 xDAI co-signer allocations.

Activation requires the Web profile, synthetic signing target, gateway verifier and database contract pin to agree. A forward database migration preserves existing challenges, receipts and source records; changing deployment identity never rewrites a signed artifact or restarts the staging database. New synthetic signatures target v2 only, while old public projections remain readable. The production identity pair and every real civic-admission boundary are unchanged.
