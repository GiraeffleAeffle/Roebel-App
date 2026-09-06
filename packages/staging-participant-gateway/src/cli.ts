#!/usr/bin/env node
import { COMPILED_SOURCE_REVISION } from "./build-constants.ts";
import { resolveProductionGatewayConfig } from "./config.ts";
import { listenStagingParticipantGatewayServer } from "./http.ts";
import { createProductionGatewayServer } from "./runtime.ts";

async function main(): Promise<void> {
  const config = resolveProductionGatewayConfig(process.env, COMPILED_SOURCE_REVISION);
  if (!config) throw new Error("staging_participant_gateway_not_explicitly_configured");
  const server = await createProductionGatewayServer(config);
  await listenStagingParticipantGatewayServer({ server, host: config.host, port: config.port });
  console.log(`staging participant gateway listening on ${config.host}:${config.port}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "staging_participant_gateway_start_failed");
  process.exitCode = 1;
});
