export function resolveSourceRevision(env, gitRevision, gitWorktreeIsClean = () => true) {
  // An explicitly provided value is authoritative: a pruned OCI context has
  // no .git directory, so an empty or invalid explicit build arg must fail.
  const explicit = Object.hasOwn(env, "SOURCE_REVISION");
  if (!explicit && !gitWorktreeIsClean()) {
    throw new Error("staging_participant_gateway_source_revision_dirty_checkout");
  }
  const revision = explicit ? env.SOURCE_REVISION : gitRevision();
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("staging_participant_gateway_source_revision_invalid");
  }
  return revision;
}
