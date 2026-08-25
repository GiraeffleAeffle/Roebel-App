export function resolveSourceRevision(env, gitRevision) {
  // An explicitly provided value is authoritative: a pruned OCI context has
  // no .git directory, so an empty or invalid explicit build arg must fail.
  const revision = Object.hasOwn(env, "SOURCE_REVISION")
    ? env.SOURCE_REVISION
    : gitRevision();
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("staging_participant_gateway_source_revision_invalid");
  }
  return revision;
}
