export interface MeteringConfig {
  nodeId: string;
  publicBase: string;
  payTo: `0x${string}`;
  network: string;
  asset: `0x${string}`;
  assetName: string;
  assetVersion: string;
  assetDecimals: number;
  prices: { bulk: string; export: string; firehoseDay: string };
  splitAuthors: number;
  facilitatorUrl: string;
  excludedFile?: string;
  port: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`missing required env var: ${name}`);
  return value;
}

export function configFromEnv(env: NodeJS.ProcessEnv): MeteringConfig {
  return {
    nodeId: required(env, "NODE_ID"),
    publicBase: required(env, "PUBLIC_BASE").replace(/\/$/, ""),
    payTo: required(env, "PAY_TO") as `0x${string}`,
    network: required(env, "NETWORK"),
    asset: required(env, "ASSET") as `0x${string}`,
    assetName: required(env, "ASSET_NAME"),
    assetVersion: required(env, "ASSET_VERSION"),
    assetDecimals: Number(required(env, "ASSET_DECIMALS")),
    prices: {
      bulk: required(env, "PRICE_BULK"),
      export: required(env, "PRICE_EXPORT"),
      firehoseDay: required(env, "PRICE_FIREHOSE_DAY"),
    },
    splitAuthors: Number(required(env, "SPLIT_AUTHORS")),
    facilitatorUrl: required(env, "FACILITATOR_URL"),
    excludedFile: env.EXCLUDED_FILE || undefined,
    port: Number(env.PORT ?? 8402),
  };
}

/** "500000",6 -> "0.50" — trailing zeros trimmed to two places minimum. */
export function formatAtomic(amount: string, decimals: number): string {
  const negative = amount.startsWith("-");
  const digits = (negative ? amount.slice(1) : amount).padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals) || "0";
  const frac = decimals ? digits.slice(-decimals) : "";
  const trimmed = frac.replace(/0+$/, "");
  const shown = trimmed.length < 2 ? frac.slice(0, 2) : trimmed;
  return `${negative ? "-" : ""}${whole}${shown ? "." + shown : ""}`;
}
