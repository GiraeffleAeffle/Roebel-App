import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  buildCitizenSignedSuggestion,
  buildCivicDiscussionEvent,
  getPublicKeyHex,
  RelayClient,
  verifyEvent,
  type CitizenSignedSuggestionV1,
  type NostrEvent,
} from "@netizen-labs/nostr";
import WebSocket from "ws";

const HEX64 = /^[0-9a-f]{64}$/;
const CASE_ID = "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";
const MAX_BODY = 256 * 1024;
const STAGING_PREFIX = "/stadtstack-test";
const SERVICE_NAMESPACES = new Set([
  "stadtstack-roebel-e2e",
  "stadtstack-roebel-staging-lab",
  "stadtstack-roebel-web-preview",
]);

type Persona = { id: string; name: string; secretKeyHex: string; publicKey: string };

export interface WorkbenchConfig {
  agentRelayUrl: string;
  bindHost: "127.0.0.1" | "0.0.0.0";
  caseStewardToken: string;
  citizenRelayUrl: string;
  controlBaseUrl: string;
  meckyPubkey: string;
  personas: Persona[];
  port: number;
  publicBaseUrl: string;
}

type RelayPort = Pick<RelayClient, "publish" | "query" | "close">;
export interface WorkbenchDependencies {
  agentRelay?: RelayPort;
  citizenRelay?: RelayPort;
  fetch?: typeof globalThis.fetch;
}

export interface RunningWorkbench {
  close(): Promise<void>;
  port: number;
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every((key) => typeof key === "string" && keys.includes(key));
}

function exactServiceUrl(
  value: string,
  protocol: "http" | "ws",
  service: "citizen-relay" | "agent-relay" | "stadtstack-control" | "stadtstack-public",
  port: 18080 | 18081,
): string {
  const match = value.match(new RegExp(`^${protocol}:\\/\\/${service}\\.([a-z0-9-]+)\\.svc\\.cluster\\.local:${port}$`));
  if (!match || !SERVICE_NAMESPACES.has(match[1] ?? "")) throw new Error(`workbench_${service}_url_invalid`);
  return value;
}

function relayUrl(value: string, service: "citizen-relay" | "agent-relay"): string {
  return exactServiceUrl(value, "ws", service, 18081);
}

function serviceUrl(value: string, service: "stadtstack-control" | "stadtstack-public", port: 18081 | 18080): string {
  return exactServiceUrl(value, "http", service, port);
}

export function parseWorkbenchConfig(environment: Record<string, string | undefined>): WorkbenchConfig {
  const rawPersonas = environment.SYNTHETIC_CITIZENS_JSON;
  let parsed: unknown;
  try { parsed = JSON.parse(rawPersonas ?? ""); } catch { throw new Error("workbench_personas_invalid"); }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw new Error("workbench_personas_invalid");
  const ids = new Set<string>();
  const publicKeys = new Set<string>();
  const personas = parsed.map((entry): Persona => {
    if (!exactRecord(entry, ["id", "name", "secretKeyHex"])) throw new Error("workbench_personas_invalid");
    const id = entry.id;
    const name = entry.name;
    const secretKeyHex = entry.secretKeyHex;
    if (typeof id !== "string" || !/^citizen-[a-z]+$/.test(id) || typeof name !== "string" || !name.trim() || typeof secretKeyHex !== "string" || !HEX64.test(secretKeyHex)) {
      throw new Error("workbench_personas_invalid");
    }
    const publicKey = getPublicKeyHex(Uint8Array.from(Buffer.from(secretKeyHex, "hex")));
    if (ids.has(id) || publicKeys.has(publicKey)) throw new Error("workbench_personas_invalid");
    ids.add(id);
    publicKeys.add(publicKey);
    return { id, name, secretKeyHex, publicKey };
  });
  const meckyPubkey = environment.MECKY_PUBKEY ?? "";
  const caseStewardToken = environment.CASE_STEWARD_TOKEN ?? "";
  const port = Number(environment.WORKBENCH_PORT ?? "18083");
  const bindHost = environment.WORKBENCH_BIND_HOST ?? "0.0.0.0";
  if (!HEX64.test(meckyPubkey) || publicKeys.has(meckyPubkey) || caseStewardToken.length < 32 || /\s/.test(caseStewardToken)) throw new Error("workbench_identity_invalid");
  if ((bindHost !== "0.0.0.0" && bindHost !== "127.0.0.1") || !Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error("workbench_listener_invalid");
  return {
    agentRelayUrl: relayUrl(environment.AGENT_RELAY_URL ?? "", "agent-relay"),
    bindHost,
    caseStewardToken,
    citizenRelayUrl: relayUrl(environment.CITIZEN_RELAY_URL ?? "", "citizen-relay"),
    controlBaseUrl: serviceUrl(environment.STADTSTACK_CONTROL_BASE_URL ?? "", "stadtstack-control", 18081),
    meckyPubkey,
    personas,
    port,
    publicBaseUrl: serviceUrl(environment.STADTSTACK_PUBLIC_BASE_URL ?? "", "stadtstack-public", 18080),
  };
}

function nodeRelay(url: string): RelayPort {
  return new RelayClient(url, {
    timeoutMs: 8_000,
    webSocketFactory: (target) => new WebSocket(target) as never,
  });
}

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY) throw new Error("body_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function persona(config: WorkbenchConfig, id: unknown): Persona {
  const value = config.personas.find((candidate) => candidate.id === id);
  if (!value) throw new Error("persona_invalid");
  return value;
}

function event(value: unknown): NostrEvent {
  if (!value || typeof value !== "object" || !verifyEvent(value as NostrEvent)) throw new Error("event_invalid");
  return value as NostrEvent;
}

async function control(config: WorkbenchConfig, fetcher: typeof globalThis.fetch, path: string, value: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(`${config.controlBaseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.caseStewardToken}`,
        "content-type": "application/json",
        "x-stadtstack-actor-id": "roebel:case-steward",
      },
      body: JSON.stringify(value),
      signal: controller.signal,
    });
    const responseValue = await response.json() as unknown;
    if (!response.ok) throw new Error(`control_${response.status}`);
    return responseValue;
  } finally {
    clearTimeout(timer);
  }
}

const HTML = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,"><title>Röbel × Stadtstack E2E</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#102a27;background:#f3f7f4}*{box-sizing:border-box}body{margin:0}header{background:#0d5146;color:white;padding:1.2rem 5vw}header p{margin:.4rem 0 0;max-width:70ch}.warning{background:#ffefb0;color:#503d00;padding:.7rem 5vw;font-weight:700}main{max-width:1100px;margin:auto;padding:2rem 5vw 4rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:1rem}.card{background:white;border:1px solid #cddbd5;border-radius:16px;padding:1rem;box-shadow:0 4px 18px #16372f12}.card h2{font-size:1.05rem;margin:.2rem 0 .8rem}.step{color:#0d6b5c;font-weight:800}.row{display:flex;gap:.6rem;flex-wrap:wrap}label{display:block;font-weight:700;margin:.6rem 0 .3rem}textarea,select,input{width:100%;padding:.75rem;border:1px solid #9eb5ad;border-radius:10px;font:inherit}button{border:0;border-radius:999px;padding:.7rem 1rem;background:#0d6b5c;color:white;font-weight:800;cursor:pointer}button.secondary{background:#ddeae5;color:#143d35}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:3px solid #ffba2f;outline-offset:2px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef5f2;padding:.75rem;border-radius:10px;min-height:3rem}.ok{color:#08733f}.error{color:#a32323}@media(max-width:640px){main{padding:1rem}.grid{grid-template-columns:1fr}}
</style></head><body>
<header><h1>Röbel × Stadtstack: kompletter Testfluss</h1><p>Diskussion → Mecky → signierter Vorschlag → Verwaltung → Citizen Brief → beratendes Mitmachen → Council-Dry-Run.</p></header>
<div class="warning">Synthetische Testumgebung · keine Produktion · keine amtliche Entscheidung · keine echte Abstimmung</div>
<main><section class="grid">
<article class="card"><div class="step">1 · Bürgerdiskussion</div><h2>Synthetische Person</h2><label for="persona">Person</label><select id="persona"></select><label for="question">Frage an Mecky</label><textarea id="question" rows="4">Wie kann die Querung der Marienfelder Straße sicherer werden?</textarea><button id="publish">Signiert diskutieren</button><pre id="discussion">Noch nicht gestartet.</pre></article>
<article class="card"><div class="step">2 · Public Mecky (Pi 0.84.1)</div><h2>Geprüfte Antwort</h2><p>Mecky darf nur aus dem checksum-gebundenen Testnachweis antworten.</p><button id="poll">Antwort abrufen</button><pre id="answer">Noch keine Antwort.</pre></article>
<article class="card"><div class="step">3 · Bürger-Signatur</div><h2>Vorschlag bearbeiten</h2><label for="title">Titel</label><input id="title" value="Sichere Querung prüfen"><label for="summary">Zusammenfassung</label><textarea id="summary" rows="4">Geprüfte Varianten sollen öffentlich und nachvollziehbar abgewogen werden.</textarea><button id="sign">Vorschlag signieren</button><pre id="suggestion">Noch nicht signiert.</pre></article>
<article class="card"><div class="step">4 · Menschliche Aufnahme</div><h2>Case Steward</h2><p>Der Steward übernimmt exakt die Bürger-Signatur; Mecky darf sie nicht selbst einreichen.</p><button id="admit">Vorschlag aufnehmen</button><pre id="admission">Noch nicht aufgenommen.</pre></article>
<article class="card"><div class="step">5 · Verwaltung und Mitmachen</div><h2>Vollständigen Testlauf ausführen</h2><p>Acht Fachpakete, Reviews, Citizen Brief, beratendes Signal und Outcome.</p><button id="complete">Testlauf ausführen</button><pre id="completion">Noch nicht ausgeführt.</pre></article>
<article class="card"><div class="step">6 · Rollensichten</div><h2>Public · Verwaltung · Council</h2><div class="row"><button class="secondary view" data-profile="public">Public</button><button class="secondary view" data-profile="administration">Verwaltung</button><button class="secondary view" data-profile="council">Council</button></div><pre id="view">Noch keine Sicht geladen.</pre></article>
</section></main>
<script>
const base='/stadtstack-test';const state={discussion:null,answer:null,suggestion:null};const $=id=>document.getElementById(id);async function api(path,body){const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json','x-stadtstack-e2e':'1'},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error||('HTTP '+response.status));return value}function show(id,value){$(id).textContent=typeof value==='string'?value:JSON.stringify(value,null,2)}
api(base+'/api/config').then(config=>{for(const person of config.personas){const option=document.createElement('option');option.value=person.id;option.textContent=person.name+' · '+person.publicKey.slice(0,12)+'…';$('persona').append(option)}}).catch(error=>show('discussion',error.message));
$('publish').onclick=async()=>{try{state.discussion=await api(base+'/api/discussion',{personaId:$('persona').value,question:$('question').value});show('discussion',state.discussion)}catch(error){show('discussion',error.message)}};
$('poll').onclick=async()=>{try{if(!state.discussion)throw new Error('Zuerst Diskussion starten.');state.answer=await api(base+'/api/reply?parent='+encodeURIComponent(state.discussion.event.id));show('answer',state.answer||'Mecky hat noch nicht geantwortet.')}catch(error){show('answer',error.message)}};
$('sign').onclick=async()=>{try{if(!state.discussion||!state.answer)throw new Error('Diskussion und Mecky-Antwort fehlen.');state.suggestion=await api(base+'/api/suggestion',{personaId:$('persona').value,discussion:state.discussion.event,answer:state.answer.event,title:$('title').value,summary:$('summary').value});show('suggestion',state.suggestion)}catch(error){show('suggestion',error.message)}};
$('admit').onclick=async()=>{try{if(!state.discussion||!state.answer||!state.suggestion)throw new Error('Signierter Vorschlag fehlt.');show('admission',await api(base+'/api/admit',{discussion:state.discussion.event,answer:state.answer.event,suggestion:state.suggestion.suggestion}))}catch(error){show('admission',error.message)}};
$('complete').onclick=async()=>{try{show('completion',await api(base+'/api/complete',{}))}catch(error){show('completion',error.message)}};
for(const button of document.querySelectorAll('.view'))button.onclick=async()=>{try{show('view',await api(base+'/api/view',{profile:button.dataset.profile}))}catch(error){show('view',error.message)}};
</script></body></html>`;

export async function startWorkbench(config: WorkbenchConfig, dependencies: WorkbenchDependencies = {}): Promise<RunningWorkbench> {
  const citizenRelay = dependencies.citizenRelay ?? nodeRelay(config.citizenRelayUrl);
  const agentRelay = dependencies.agentRelay ?? nodeRelay(config.agentRelayUrl);
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const server: Server = createServer((request, response) => { void (async () => {
    const requestedPath = request.url ?? "";
    const prefixed = requestedPath === STAGING_PREFIX || requestedPath.startsWith(`${STAGING_PREFIX}/`);
    const path = prefixed ? requestedPath.slice(STAGING_PREFIX.length) || "/" : requestedPath;
    if (request.method === "GET" && (path === "/" || path === "")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
      response.end(HTML);
      return;
    }
    if (request.method === "GET" && path === "/healthz") return json(response, 200, { status: "ok", mode: "synthetic-e2e" });
    if (request.method === "GET" && path === "/api/config") return json(response, 200, {
      schemaVersion: "roebel_e2e_workbench_config_v1",
      personas: config.personas.map(({ id, name, publicKey }) => ({ id, name, publicKey })),
      meckyPubkey: config.meckyPubkey,
      authorityBinding: "none",
    });
    if (request.method === "GET" && path.startsWith("/api/reply?parent=")) {
      const parent = new URL(path, "http://workbench").searchParams.get("parent") ?? "";
      if (!HEX64.test(parent)) return json(response, 400, { error: "parent_invalid" });
      const events = await agentRelay.query([{ kinds: [1], authors: [config.meckyPubkey], "#e": [parent], limit: 5 }]);
      const answer = events.filter(verifyEvent).sort((a, b) => b.created_at - a.created_at)[0] ?? null;
      return json(response, 200, answer ? { status: "answered", event: answer } : null);
    }
    if (request.method !== "POST" || request.headers["x-stadtstack-e2e"] !== "1") return json(response, 404, { error: "not_found" });
    const body = await readBody(request);
    if (path === "/api/discussion") {
      if (!exactRecord(body, ["personaId", "question"]) || typeof body.question !== "string" || !body.question.trim() || body.question.length > 1_000) throw new Error("discussion_invalid");
      const actor = persona(config, body.personaId);
      const signed = buildCivicDiscussionEvent(Uint8Array.from(Buffer.from(actor.secretKeyHex, "hex")), {
        municipalityId: "roebel-mueritz",
        sourceCaseId: "marienfelder-strasse",
        canonicalCaseId: CASE_ID,
        agentPubkey: config.meckyPubkey,
        content: `@Mecky, ${body.question.trim()}`,
      });
      const published = await citizenRelay.publish(signed);
      if (!published.ok) throw new Error(`citizen_relay_${published.message}`);
      return json(response, 200, { status: "published", persona: { id: actor.id, name: actor.name, publicKey: actor.publicKey }, event: signed });
    }
    if (path === "/api/suggestion") {
      if (!exactRecord(body, ["personaId", "discussion", "answer", "title", "summary"]) || typeof body.title !== "string" || typeof body.summary !== "string") throw new Error("suggestion_invalid");
      const actor = persona(config, body.personaId);
      const discussion = event(body.discussion);
      const answer = event(body.answer);
      if (discussion.pubkey !== actor.publicKey || answer.pubkey !== config.meckyPubkey) throw new Error("suggestion_actor_mismatch");
      const suggestion = buildCitizenSignedSuggestion(Uint8Array.from(Buffer.from(actor.secretKeyHex, "hex")), {
        binding: { municipalityId: "roebel-mueritz", sourceCaseId: "marienfelder-strasse", canonicalCaseId: CASE_ID },
        agentPubkey: config.meckyPubkey,
        sourceDiscussion: discussion,
        sourceAnswer: answer,
        title: body.title,
        summary: body.summary,
        createdAt: Math.floor(Date.now() / 1_000),
      });
      const suggestionEvent: NostrEvent = {
        id: suggestion.event.id,
        pubkey: suggestion.event.pubkey,
        created_at: suggestion.event.createdAt,
        kind: suggestion.event.kind,
        tags: suggestion.event.tags,
        content: suggestion.event.content,
        sig: suggestion.event.signature,
      };
      const published = await citizenRelay.publish(suggestionEvent);
      if (!published.ok) throw new Error(`citizen_relay_${published.message}`);
      return json(response, 200, { status: "signed", suggestion, event: suggestionEvent });
    }
    if (path === "/api/admit") {
      if (!exactRecord(body, ["discussion", "answer", "suggestion"])) throw new Error("admission_invalid");
      return json(response, 200, await control(config, fetcher, "/v1/nostr/suggestions/admit", {
        expectedCaseVersion: 2,
        sourceDiscussion: event(body.discussion),
        sourceAnswer: event(body.answer),
        signedSuggestion: body.suggestion as CitizenSignedSuggestionV1,
      }));
    }
    if (path === "/api/complete") {
      if (!exactRecord(body, [])) throw new Error("complete_invalid");
      return json(response, 200, await control(config, fetcher, "/v1/e2e/complete", {}));
    }
    if (path === "/api/view") {
      if (!exactRecord(body, ["profile"]) || !["public", "administration", "council"].includes(String(body.profile))) throw new Error("view_invalid");
      return json(response, 200, await control(config, fetcher, "/v1/e2e/view", { profile: body.profile }));
    }
    return json(response, 404, { error: "not_found" });
  })().catch((error: unknown) => {
    if (!response.writableEnded) json(response, error instanceof SyntaxError ? 400 : 422, { error: error instanceof Error ? error.message : "workbench_failed" });
  }); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.bindHost, () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("workbench_listener_invalid");
  return {
    port: address.port,
    close: async () => {
      citizenRelay.close();
      if (agentRelay !== citizenRelay) agentRelay.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
