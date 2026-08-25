export function resolveSourceRevision(
  env: Record<string, string | undefined>,
  gitRevision: () => string,
  gitWorktreeIsClean?: () => boolean,
): string;
