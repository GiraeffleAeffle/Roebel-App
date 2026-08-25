import type { StagingParticipantGatewayConfig } from "./types.ts";

/**
 * REVIEW HOLD — the custom writer-token wiring in this first draft is not an
 * accepted deployment boundary. It remains source-only for the handler tests;
 * replace it with the reviewed constrained-RPC credential design before any
 * manifest may enable this gateway.
 */

export type ProductionGatewayConfig = Readonly<{
  gateway: StagingParticipantGatewayConfig;
  gnosisRpcUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseWriterToken: string;
  host: string;
  port: number;
}>;

function nonEmpty(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integerPort(value: string | undefined): number | null {
  const parsed = Number(value ?? "");
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : null;
}

/** Fail closed unless the dedicated staging gateway is explicitly enabled. */
export function resolveProductionGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): ProductionGatewayConfig | null {
  if (env.ROEBEL_STAGING_PARTICIPANT_GATEWAY !== "enabled") return null;
  const origin = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_ORIGIN);
  const sessionHmacKey = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SESSION_KEY);
  const inviteSha256 = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_INVITE_SHA256);
  const gnosisRpcUrl = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_GNOSIS_RPC_URL);
  const supabaseUrl = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_URL);
  const supabaseAnonKey = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY);
  const supabaseWriterToken = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_WRITER_TOKEN);
  const host = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_HOST) ?? "127.0.0.1";
  const port = integerPort(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_PORT);
  if (!origin || !sessionHmacKey || sessionHmacKey.length < 32 || !inviteSha256 ||
    !/^[a-f0-9]{64}$/iu.test(inviteSha256) || !gnosisRpcUrl || !supabaseUrl ||
    !supabaseAnonKey || supabaseAnonKey.length < 16 || !supabaseWriterToken ||
    supabaseWriterToken.length < 32 || !port) return null;
  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
    new URL(gnosisRpcUrl);
    new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (normalizedOrigin !== origin || !["127.0.0.1", "0.0.0.0"].includes(host)) return null;
  return {
    gateway: {
      origin,
      sessionHmacKey,
      inviteSha256: inviteSha256.toLowerCase(),
      cookieSecure: env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_COOKIE_SECURE !== "false",
    },
    gnosisRpcUrl,
    supabaseUrl,
    supabaseAnonKey,
    supabaseWriterToken,
    host,
    port,
  };
}
