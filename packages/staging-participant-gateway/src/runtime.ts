import {
  createGnosisWalletVerifier,
  createPinnedCitizenNftEligibilityVerifier,
} from "@netizen-labs/relay-sync";

import type { ProductionGatewayConfig } from "./config.ts";
import { createStagingParticipantGatewayServer } from "./http.ts";
import {
  createRestrictedSupabaseDataAdapter,
  createStagingParticipantReadinessAdapter,
  requireCitizenAdoptionStatusReadiness,
} from "./supabase-adapter.ts";
import { createCitizenEligibilityStatusResolver } from "./citizen-eligibility-status.ts";
import { createRestrictedSupabaseCitizenStatusReader } from "./citizen-eligibility-status-supabase-adapter.ts";
import { createCitizenAdoptionService } from "./citizen-adoption.ts";
import { createRestrictedSupabaseCitizenAdoptionAdapter } from "./citizen-adoption-supabase-adapter.ts";
import { createSyntheticCitizenAdoptionService } from "./synthetic-citizen-adoption.ts";
import { createRestrictedSupabaseSyntheticCitizenAdoptionAdapter } from "./synthetic-citizen-adoption-supabase-adapter.ts";
import {
  createPrivateWorkbenchCitizenSuggestionThreadResolver,
  createPrivateWorkbenchMeckyMirrorAdapter,
  createPrivateWorkbenchTopicTracerAdapter,
} from "./workbench-adapter.ts";

/** Compose the production adapters before the CLI opens a listening socket. */
export async function createProductionGatewayServer(config: ProductionGatewayConfig) {
  const supabase = {
    url: config.supabaseUrl,
    anonKey: config.supabaseAnonKey,
    rpcSecret: config.supabaseRpcSecret,
  };
  const walletVerifier = createGnosisWalletVerifier({
    rpcUrl: config.gnosisRpcUrl,
  });
  const readiness = createStagingParticipantReadinessAdapter(supabase);
  const statusPreflight = () => requireCitizenAdoptionStatusReadiness(readiness, config.readinessPins);
  if (config.citizenEligibilityStatusEnabled) await statusPreflight();
  const eligibilityVerifier = createPinnedCitizenNftEligibilityVerifier({
    rpcUrl: config.gnosisRpcUrl,
    citizenNftAddress: config.citizenAdoption.citizenNftAddress,
    citizenNftRuntimeCodeHash: config.citizenAdoption.citizenNftRuntimeCodeHash,
  });
  const citizenEligibilityStatus = config.citizenEligibilityStatusEnabled
    ? createCitizenEligibilityStatusResolver({
        policy: config.citizenAdoption.policy,
        issuer: config.citizenAdoption.issuer,
        receipts: createRestrictedSupabaseCitizenStatusReader({
          ...supabase,
          municipalityId: config.citizenAdoption.policy.municipalityId,
          policyVersion: config.citizenAdoption.policy.policyVersion,
        }),
        eligibilityVerifier,
        preflight: statusPreflight,
      })
    : undefined;
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
    eligibilityVerifier,
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
  return createStagingParticipantGatewayServer({
    config: config.gateway,
    verifier: walletVerifier,
    data: createRestrictedSupabaseDataAdapter(supabase),
    readiness,
    readinessPins: config.readinessPins,
    mirror: createPrivateWorkbenchMeckyMirrorAdapter(config.workbench),
    topicTracer: createPrivateWorkbenchTopicTracerAdapter(config.workbench),
    citizenAdoption,
    citizenEligibilityStatus,
    syntheticCitizenAdoption,
  });
}
