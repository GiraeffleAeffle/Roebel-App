#!/usr/bin/env node
import {
  createGnosisWalletVerifier,
  createPinnedCitizenNftEligibilityVerifier,
} from "@netizen-labs/relay-sync";

import { COMPILED_SOURCE_REVISION } from "./build-constants.ts";
import { resolveProductionGatewayConfig } from "./config.ts";
import {
  createStagingParticipantGatewayServer,
  listenStagingParticipantGatewayServer,
} from "./http.ts";
import { createRestrictedSupabaseDataAdapter, createStagingParticipantReadinessAdapter } from "./supabase-adapter.ts";
import { createCitizenAdoptionService } from "./citizen-adoption.ts";
import { createRestrictedSupabaseCitizenAdoptionAdapter } from "./citizen-adoption-supabase-adapter.ts";
import { createSyntheticCitizenAdoptionService } from "./synthetic-citizen-adoption.ts";
import { createRestrictedSupabaseSyntheticCitizenAdoptionAdapter } from "./synthetic-citizen-adoption-supabase-adapter.ts";
import {
  createPrivateWorkbenchCitizenSuggestionThreadResolver,
  createPrivateWorkbenchMeckyMirrorAdapter,
  createPrivateWorkbenchTopicTracerAdapter,
} from "./workbench-adapter.ts";

async function main(): Promise<void> {
  const config = resolveProductionGatewayConfig(process.env, COMPILED_SOURCE_REVISION);
  if (!config) {
    throw new Error("staging_participant_gateway_not_explicitly_configured");
  }
  const supabase = {
    url: config.supabaseUrl,
    anonKey: config.supabaseAnonKey,
    rpcSecret: config.supabaseRpcSecret,
  };
  const walletVerifier = createGnosisWalletVerifier({
    rpcUrl: config.gnosisRpcUrl,
  });
  const citizenAdoptionStorage =
    createRestrictedSupabaseCitizenAdoptionAdapter({
      ...supabase,
      municipalityId: config.citizenAdoption.policy.municipalityId,
      resolveSuggestionThread:
        createPrivateWorkbenchCitizenSuggestionThreadResolver(config.workbench),
    });
  const citizenAdoption = createCitizenAdoptionService({
    policy: config.citizenAdoption.policy,
    issuer: config.citizenAdoption.issuer,
    sources: citizenAdoptionStorage,
    challenges: citizenAdoptionStorage,
    walletVerifier,
    eligibilityVerifier: createPinnedCitizenNftEligibilityVerifier({
      rpcUrl: config.gnosisRpcUrl,
      citizenNftAddress: config.citizenAdoption.citizenNftAddress,
      citizenNftRuntimeCodeHash:
        config.citizenAdoption.citizenNftRuntimeCodeHash,
    }),
    receipts: citizenAdoptionStorage,
    ledger: citizenAdoptionStorage,
  });
  const syntheticCitizenAdoptionStorage = config.syntheticCitizenAdoption
    ? createRestrictedSupabaseSyntheticCitizenAdoptionAdapter({
        ...supabase,
        municipalityId: config.syntheticCitizenAdoption.policy.municipalityId,
      })
    : null;
  const syntheticCitizenAdoption = config.syntheticCitizenAdoption &&
      syntheticCitizenAdoptionStorage
    ? createSyntheticCitizenAdoptionService({
        policy: config.syntheticCitizenAdoption.policy,
        sources: citizenAdoptionStorage,
        challenges: syntheticCitizenAdoptionStorage,
        walletVerifier,
        eligibilityVerifier: createPinnedCitizenNftEligibilityVerifier({
          rpcUrl: config.gnosisRpcUrl,
          citizenNftAddress:
            config.syntheticCitizenAdoption.policy.testCitizenNftAddress,
          citizenNftRuntimeCodeHash:
            config.syntheticCitizenAdoption.policy.testCitizenNftRuntimeCodeKeccak256,
        }),
        ledger: syntheticCitizenAdoptionStorage,
      })
    : undefined;
  const server = createStagingParticipantGatewayServer({
    config: config.gateway,
    verifier: walletVerifier,
    data: createRestrictedSupabaseDataAdapter(supabase),
    readiness: createStagingParticipantReadinessAdapter(supabase),
    readinessPins: config.readinessPins,
    mirror: createPrivateWorkbenchMeckyMirrorAdapter(config.workbench),
    topicTracer: createPrivateWorkbenchTopicTracerAdapter(config.workbench),
    citizenAdoption,
    syntheticCitizenAdoption,
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
