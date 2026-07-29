#!/usr/bin/env node
import { deriveAgentIdentity } from "@netizen-labs/nostr";
import { DEFAULT_BOUNDS, emptyHistory } from "./bounds";
import { announceAgentProfile } from "./profile";
import { watchOnce } from "./watcher";

/**
 * `netizen-agent-watcher` — runs beside the relay and answers mentions.
 *
 * Deliberately stateless across restarts except for what it can re-derive: the
 * lookback window plus the relay's own record mean a restart re-reads recent
 * mentions rather than losing them, and the answered-set stops duplicates within
 * a run. A missed answer is recoverable; a double answer is not.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`missing required env var: ${name}`);
    process.exit(2);
  }
  return value;
}

/**
 * Ask Claude, with the one instruction that matters for a civic feed.
 *
 * An agent that confabulates municipal facts is worse than no agent, because it
 * does so wearing the town's identity. So: answer from what you know, say plainly
 * when you do not know, and never invent an official position.
 */
async function think(apiKey: string, model: string, nodeName: string, question: string): Promise<string | null> {
  const system =
    `Du bist Mecky, der öffentliche KI-Begleiter von ${nodeName}. ` +
    `Antworte kurz (höchstens 3 Sätze), auf Deutsch, freundlich und sachlich. ` +
    `Wenn du etwas nicht sicher weißt, sage das ausdrücklich und erfinde nichts — ` +
    `besonders keine Beschlüsse, Termine, Zahlen oder Zuständigkeiten der Verwaltung. ` +
    `Du hast keine amtliche Autorität und triffst keine Entscheidungen.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      system,
      messages: [{ role: "user", content: question }],
    }),
  });

  if (!res.ok) {
    console.error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
  return text || null;
}

async function main(): Promise<void> {
  const nodeId = required("NODE_ID");
  const nodeName = process.env.NODE_NAME ?? nodeId;
  const agentName = process.env.AGENT_NAME ?? "mecky";
  const relayUrl = required("RELAY_URL");
  const apiKey = required("ANTHROPIC_API_KEY");
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
  const intervalSeconds = Number(process.env.WATCH_INTERVAL_SECONDS ?? 20);

  const agent = deriveAgentIdentity(required("NODE_AGENT_SECRET"), nodeId, agentName);
  const history = emptyHistory();
  const bounds = {
    ...DEFAULT_BOUNDS,
    enabled: process.env.AGENT_ENABLED !== "false",
    perAuthorPerHour: Number(process.env.AGENT_PER_AUTHOR_PER_HOUR ?? DEFAULT_BOUNDS.perAuthorPerHour),
    perDay: Number(process.env.AGENT_PER_DAY ?? DEFAULT_BOUNDS.perDay),
  };

  console.log(`agent "${agentName}" on "${nodeId}" watching ${relayUrl}`);
  console.log(`  npub ${agent.npub}`);
  console.log(`  bounds: ${bounds.perAuthorPerHour}/author/h, ${bounds.perDay}/day, enabled=${bounds.enabled}`);

  // Introduce ourselves before answering anything. kind 0 is replaceable, so this
  // is idempotent across restarts, and it means a re-keyed agent is never left
  // publishing under a pubkey no client can put a name to.
  await announceAgentProfile({
    agent,
    relayUrl,
    metadata: {
      name: process.env.AGENT_DISPLAY_NAME ?? agentName[0].toUpperCase() + agentName.slice(1),
      about:
        process.env.AGENT_ABOUT ??
        `KI-Assistent von ${nodeName}. Antwortet, wenn man ihn erwähnt.`,
      ...(process.env.AGENT_PICTURE ? { picture: process.env.AGENT_PICTURE } : {}),
    },
    log: (m) => console.log(`  ${m}`),
  });

  const pass = async () => {
    try {
      const result = await watchOnce({
        agent,
        history,
        bounds,
        relayUrl,
        think: (question) => think(apiKey, model, nodeName, question),
        log: (m) => console.log(`[${new Date().toISOString()}] ${m}`),
      });
      if (result.answered || Object.keys(result.refused).length) {
        console.log(
          `[${new Date().toISOString()}] seen ${result.seen}, answered ${result.answered}` +
            (Object.keys(result.refused).length ? `, refused ${JSON.stringify(result.refused)}` : ""),
        );
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] pass failed:`, (error as Error).message);
    }
  };

  await pass();
  setInterval(() => void pass(), intervalSeconds * 1000);
}

void main().catch((error) => {
  console.error("agent watcher failed to start:", error);
  process.exit(1);
});
