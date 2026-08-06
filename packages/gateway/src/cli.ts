#!/usr/bin/env node
import pg from "pg";
import { configFromEnv } from "./config.js";
import { FacilitatorClient } from "./x402.js";
import { loadExclusions } from "./exclusions.js";
import { LEDGER_SCHEMA_SQL } from "./ledger.js";
import { createGatewayServer } from "./server.js";

async function main(): Promise<void> {
  const cfg = configFromEnv(process.env);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
  await pool.query(LEDGER_SCHEMA_SQL);

  let excluded = cfg.excludedFile ? loadExclusions(cfg.excludedFile) : new Set<string>();
  if (cfg.excludedFile) {
    setInterval(() => {
      excluded = loadExclusions(cfg.excludedFile!);
    }, 60_000);
  }

  createGatewayServer({
    cfg,
    query: async (sql, values) => (await pool.query(sql, values)).rows,
    facilitator: new FacilitatorClient(cfg.facilitatorUrl),
    excluded: () => excluded,
  }).listen(cfg.port, () => {
    console.log(`gateway for "${cfg.nodeId}" listening on :${cfg.port}; facilitator ${cfg.facilitatorUrl}`);
    console.log(`  prices bulk=${cfg.prices.bulk} export=${cfg.prices.export} firehoseDay=${cfg.prices.firehoseDay} (atomic, ${cfg.assetName})`);
  });
}

void main().catch((error) => {
  console.error("gateway failed to start:", error);
  process.exit(1);
});
