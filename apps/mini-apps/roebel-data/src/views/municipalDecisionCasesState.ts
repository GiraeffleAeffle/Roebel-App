import { StadtstackFederationError } from "@roebel/stadtstack-federation-client";

export type MunicipalDecisionCaseFailureStatus =
  | "not_found"
  | "unavailable"
  | "invalid"
  | "withdrawn";

export function classifyMunicipalDecisionCaseFailure(
  error: unknown,
): MunicipalDecisionCaseFailureStatus {
  if (!(error instanceof StadtstackFederationError)) return "invalid";
  if (error.code === "not_found") return "not_found";
  if (error.code === "withdrawn") return "withdrawn";
  if (["network", "timeout", "http"].includes(error.code)) return "unavailable";
  return "invalid";
}
