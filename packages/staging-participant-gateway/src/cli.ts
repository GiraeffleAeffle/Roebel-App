#!/usr/bin/env node
import { createGnosisWalletVerifier } from "@netizen-labs/relay-sync";
import { readFileSync } from "node:fs";

import { resolveProductionGatewayConfig } from "./config.ts";
import {
  createStagingParticipantGatewayServer,
  listenStagingParticipantGatewayServer,
} from "./http.ts";
import { createRestrictedSupabaseDataAdapter, createStagingParticipantReadinessAdapter } from "./supabase-adapter.ts";
import { createPrivateWorkbenchMeckyMirrorAdapter } from "./workbench-adapter.ts";

async function main(): Promise<void> {
  let bakedSourceRevision: string;
  try {
    bakedSourceRevision = readFileSync("/app/source-revision", "utf8").trim();
  } catch {
    throw new Error("staging_participant_gateway_baked_source_missing");
  }
  const config = resolveProductionGatewayConfig(process.env, bakedSourceRevision);
  if (!config) {
    throw new Error("staging_participant_gateway_not_explicitly_configured");
  }
  const supabase = {
    url: config.supabaseUrl,
    anonKey: config.supabaseAnonKey,
    rpcSecret: config.supabaseRpcSecret,
  };
  const server = createStagingParticipantGatewayServer({
    config: config.gateway,
    verifier: createGnosisWalletVerifier({ rpcUrl: config.gnosisRpcUrl }),
    data: createRestrictedSupabaseDataAdapter(supabase),
    readiness: createStagingParticipantReadinessAdapter(supabase),
    readinessPins: config.readinessPins,
    mirror: createPrivateWorkbenchMeckyMirrorAdapter(config.workbench),
  });
  await listenStagingParticipantGatewayServer({
    server,
    host: config.host,
    port: config.port,
  });
  console.log(`staging participant gateway listening on ${config.host}:${config.port}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "staging_participant_gateway_start_failed");
  process.exitCode = 1;
});
