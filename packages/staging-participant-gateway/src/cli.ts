#!/usr/bin/env node
import { createGnosisWalletVerifier } from "@netizen-labs/relay-sync";

import { resolveProductionGatewayConfig } from "./config.ts";
import {
  createStagingParticipantGatewayServer,
  listenStagingParticipantGatewayServer,
} from "./http.ts";
import { createRestrictedSupabaseDataAdapter } from "./supabase-adapter.ts";

async function main(): Promise<void> {
  const config = resolveProductionGatewayConfig();
  if (!config) {
    throw new Error("staging_participant_gateway_not_explicitly_configured");
  }
  const server = createStagingParticipantGatewayServer({
    config: config.gateway,
    verifier: createGnosisWalletVerifier({ rpcUrl: config.gnosisRpcUrl }),
    data: createRestrictedSupabaseDataAdapter({
      url: config.supabaseUrl,
      anonKey: config.supabaseAnonKey,
      writerToken: config.supabaseWriterToken,
    }),
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
