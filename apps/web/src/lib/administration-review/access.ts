export type AdministrationAccessState =
  | "ready"
  | "sign-in"
  | "no-current-role"
  | "unavailable";

type ErrorPayload = { error?: unknown; reason?: unknown };

function errorCode(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const value = payload as ErrorPayload;
  return value.error ?? value.reason;
}

/**
 * Classify the role-directory response without treating every 401/403 as the
 * same thing. The review gateway's error code is authoritative where status
 * alone can also describe an upstream failure.
 */
export function classifyAdministrationAccess(
  status: number,
  payload: unknown,
): AdministrationAccessState {
  const code = errorCode(payload);
  if (status >= 200 && status < 300) return "ready";
  if (status === 401 && code === "authentication_required") return "sign-in";
  if (status === 403 && code === "review_role_required") return "no-current-role";
  return "unavailable";
}
