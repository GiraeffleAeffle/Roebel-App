import type { StagingParticipantGatewayConfig } from "./types.ts";

export type ProductionGatewayConfig = Readonly<{
  gateway: StagingParticipantGatewayConfig;
  gnosisRpcUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseRpcSecret: string;
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

function walletAllowlist(value: string | undefined): readonly string[] | null {
  const wallets = [...new Set(
    (value ?? "").split(",").map((wallet) => wallet.trim().toLowerCase()).filter(Boolean),
  )];
  return wallets.length >= 1 && wallets.length <= 8 &&
    wallets.every((wallet) => /^0x[0-9a-f]{40}$/u.test(wallet))
    ? wallets
    : null;
}

/** Fail closed unless the dedicated staging gateway is explicitly enabled. */
export function resolveProductionGatewayConfig(
  env: Record<string, string | undefined> = process.env,
): ProductionGatewayConfig | null {
  if (env.ROEBEL_STAGING_PARTICIPANT_GATEWAY !== "enabled") return null;
  const origin = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_ORIGIN);
  const sessionHmacKey = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SESSION_KEY);
  const inviteSha256 = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_INVITE_SHA256);
  const allowedWallets = walletAllowlist(
    env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_ALLOWED_WALLETS,
  );
  const gnosisRpcUrl = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_GNOSIS_RPC_URL);
  const supabaseUrl = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_URL);
  const supabaseAnonKey = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_ANON_KEY);
  const supabaseRpcSecret = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_SUPABASE_RPC_SECRET);
  const host = nonEmpty(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_HOST) ?? "127.0.0.1";
  const port = integerPort(env.ROEBEL_STAGING_PARTICIPANT_GATEWAY_PORT);
  if (!origin || !sessionHmacKey || sessionHmacKey.length < 32 || !inviteSha256 ||
    !allowedWallets ||
    !/^[a-f0-9]{64}$/iu.test(inviteSha256) || !gnosisRpcUrl || !supabaseUrl ||
    !supabaseAnonKey || supabaseAnonKey.length < 16 || !supabaseRpcSecret ||
    supabaseRpcSecret.length < 32 || !port) return null;
  let originUrl: URL;
  let gnosisUrl: URL;
  let supabaseUrlValue: URL;
  try {
    originUrl = new URL(origin);
    gnosisUrl = new URL(gnosisRpcUrl);
    supabaseUrlValue = new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (originUrl.origin !== origin || originUrl.protocol !== "https:" ||
    gnosisUrl.protocol !== "https:" || supabaseUrlValue.protocol !== "https:" ||
    !["127.0.0.1", "0.0.0.0"].includes(host)) return null;
  return {
    gateway: {
      origin,
      sessionHmacKey,
      inviteSha256: inviteSha256.toLowerCase(),
      allowedWallets,
      cookieSecure: true,
    },
    gnosisRpcUrl,
    supabaseUrl,
    supabaseAnonKey,
    supabaseRpcSecret,
    host,
    port,
  };
}
