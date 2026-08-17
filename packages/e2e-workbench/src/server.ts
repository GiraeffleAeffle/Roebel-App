import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  bindingStatement,
  buildCitizenSignedSuggestion,
  buildCivicDiscussionEvent,
  buildCivicPromotionEvent,
  buildNoteEvent,
  buildProfileEvent,
  getPublicKeyHex,
  isAgentEvent,
  RelayClient,
  verifyBindingEvent,
  verifyEvent,
  type CitizenSignedSuggestionV1,
  type NostrEvent,
} from "@netizen-labs/nostr";
import { createGnosisWalletVerifier } from "@netizen-labs/relay-sync";
import WebSocket from "ws";

const HEX64 = /^[0-9a-f]{64}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const WALLET_SIGNATURE = /^0x[0-9a-f]+$/;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const CASE_ID =
  "urn:stadtstack:case:municipality:roebel-mueritz:018f0000-0000-7000-8000-000000000001";
const MARIENFELDER_TOPIC_ID =
  "urn:stadtstack:topic:municipality:roebel-mueritz:marienfelder-strasse";
const MARIENFELDER_TOPIC_TITLE = "Marienfelder Straße";
const MAX_BODY = 256 * 1024;
const STAGING_PREFIX = "/stadtstack-test";
const SERVICE_NAMESPACES = new Set([
  "stadtstack-roebel-e2e",
  "stadtstack-roebel-staging-lab",
  "stadtstack-roebel-web-preview",
]);

type Persona = {
  id: string;
  name: string;
  secretKeyHex: string;
  publicKey: string;
};

type PublicAuthor = {
  name: string;
  kind: "citizen" | "mecky";
  pubkey: string;
  synthetic: boolean;
};
type PublicArgument = {
  id: string;
  parentId: string | null;
  rootId: string;
  stance: "root" | "pro" | "con";
  author: PublicAuthor;
  content: string;
  createdAt: string;
};

export interface WorkbenchConfig {
  agentRelayUrl: string;
  bindHost: "127.0.0.1" | "0.0.0.0";
  caseStewardToken: string;
  citizenRelayAdmissionToken: string;
  citizenRelayUrl: string;
  controlBaseUrl: string;
  gnosisRpcUrl: string;
  meckyPubkey: string;
  personas: Persona[];
  port: number;
  publicBaseUrl: string;
}

type RelayPort = Pick<RelayClient, "publish" | "query" | "close">;
export interface WorkbenchDependencies {
  admitPubkey?: (pubkey: string) => Promise<void>;
  agentRelay?: RelayPort;
  citizenRelay?: RelayPort;
  fetch?: typeof globalThis.fetch;
  verifyWalletSignature?: (args: {
    address: string;
    message: string;
    signature: string;
  }) => Promise<boolean>;
}

export interface RunningWorkbench {
  close(): Promise<void>;
  port: number;
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    return false;
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === keys.length &&
    actual.every((key) => typeof key === "string" && keys.includes(key))
  );
}

function exactServiceUrl(
  value: string,
  protocol: "http" | "ws",
  service:
    | "citizen-relay"
    | "agent-relay"
    | "stadtstack-control"
    | "stadtstack-public",
  port: 18080 | 18081
): string {
  const match = value.match(
    new RegExp(
      `^${protocol}:\\/\\/${service}\\.([a-z0-9-]+)\\.svc\\.cluster\\.local:${port}$`
    )
  );
  if (!match || !SERVICE_NAMESPACES.has(match[1] ?? ""))
    throw new Error(`workbench_${service}_url_invalid`);
  return value;
}

function relayUrl(
  value: string,
  service: "citizen-relay" | "agent-relay"
): string {
  return exactServiceUrl(value, "ws", service, 18081);
}

function serviceUrl(
  value: string,
  service: "stadtstack-control" | "stadtstack-public",
  port: 18081 | 18080
): string {
  return exactServiceUrl(value, "http", service, port);
}

function externalHttpsUrl(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`workbench_${name}_invalid`);
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    value.length > 2_048
  )
    throw new Error(`workbench_${name}_invalid`);
  return parsed.toString().replace(/\/$/, "");
}

export function parseWorkbenchConfig(
  environment: Record<string, string | undefined>
): WorkbenchConfig {
  const rawPersonas = environment.SYNTHETIC_CITIZENS_JSON;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPersonas ?? "");
  } catch {
    throw new Error("workbench_personas_invalid");
  }
  if (!Array.isArray(parsed) || parsed.length !== 2)
    throw new Error("workbench_personas_invalid");
  const ids = new Set<string>();
  const publicKeys = new Set<string>();
  const personas = parsed.map((entry): Persona => {
    if (!exactRecord(entry, ["id", "name", "secretKeyHex"]))
      throw new Error("workbench_personas_invalid");
    const id = entry.id;
    const name = entry.name;
    const secretKeyHex = entry.secretKeyHex;
    if (
      typeof id !== "string" ||
      !/^citizen-[a-z]+$/.test(id) ||
      typeof name !== "string" ||
      !name.trim() ||
      typeof secretKeyHex !== "string" ||
      !HEX64.test(secretKeyHex)
    ) {
      throw new Error("workbench_personas_invalid");
    }
    const publicKey = getPublicKeyHex(
      Uint8Array.from(Buffer.from(secretKeyHex, "hex"))
    );
    if (ids.has(id) || publicKeys.has(publicKey))
      throw new Error("workbench_personas_invalid");
    ids.add(id);
    publicKeys.add(publicKey);
    return { id, name, secretKeyHex, publicKey };
  });
  const meckyPubkey = environment.MECKY_PUBKEY ?? "";
  const caseStewardToken = environment.CASE_STEWARD_TOKEN ?? "";
  const citizenRelayAdmissionToken =
    environment.CITIZEN_RELAY_ADMISSION_TOKEN ?? "";
  const port = Number(environment.WORKBENCH_PORT ?? "18083");
  const bindHost = environment.WORKBENCH_BIND_HOST ?? "0.0.0.0";
  if (
    !HEX64.test(meckyPubkey) ||
    publicKeys.has(meckyPubkey) ||
    caseStewardToken.length < 32 ||
    /\s/.test(caseStewardToken) ||
    citizenRelayAdmissionToken.length < 32 ||
    /\s/.test(citizenRelayAdmissionToken)
  )
    throw new Error("workbench_identity_invalid");
  if (
    (bindHost !== "0.0.0.0" && bindHost !== "127.0.0.1") ||
    !Number.isSafeInteger(port) ||
    port < 0 ||
    port > 65_535
  )
    throw new Error("workbench_listener_invalid");
  return {
    agentRelayUrl: relayUrl(environment.AGENT_RELAY_URL ?? "", "agent-relay"),
    bindHost,
    caseStewardToken,
    citizenRelayAdmissionToken,
    citizenRelayUrl: relayUrl(
      environment.CITIZEN_RELAY_URL ?? "",
      "citizen-relay"
    ),
    controlBaseUrl: serviceUrl(
      environment.STADTSTACK_CONTROL_BASE_URL ?? "",
      "stadtstack-control",
      18081
    ),
    gnosisRpcUrl: externalHttpsUrl(
      environment.GNOSIS_RPC_URL ?? "",
      "gnosis_rpc_url"
    ),
    meckyPubkey,
    personas,
    port,
    publicBaseUrl: serviceUrl(
      environment.STADTSTACK_PUBLIC_BASE_URL ?? "",
      "stadtstack-public",
      18080
    ),
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
  if (
    !exactRecord(value, [
      "id",
      "pubkey",
      "created_at",
      "kind",
      "tags",
      "content",
      "sig",
    ]) ||
    !verifyEvent(value as unknown as NostrEvent)
  )
    throw new Error("event_invalid");
  return value as unknown as NostrEvent;
}

function secret(persona: Persona): Uint8Array {
  return Uint8Array.from(Buffer.from(persona.secretKeyHex, "hex"));
}

function tagValue(event: NostrEvent, name: string): string | null {
  return (
    event.tags.find(
      (tag) => tag[0] === name && typeof tag[1] === "string"
    )?.[1] ?? null
  );
}

function sourceAppPostIdFor(event: NostrEvent): string | null {
  const matches = event.tags.filter((tag) => tag[0] === "source-app-post");
  return matches.length === 1 &&
    matches[0]!.length === 2 &&
    UUID.test(matches[0]![1] ?? "")
    ? matches[0]![1]!
    : null;
}

function topicFor(event: NostrEvent): { id: string; title: string } | null {
  const explicit = tagValue(event, "topic");
  const municipality = tagValue(event, "municipality");
  const sourceCase = tagValue(event, "case");
  const topicParts = explicit?.split(":") ?? [];
  const topicTitles = event.tags.filter(
    (tag) => tag[0] === "topic-title" && typeof tag[1] === "string"
  );
  if (
    topicParts.length === 6 &&
    topicParts.slice(0, 4).join(":") ===
      "urn:stadtstack:topic:municipality" &&
    topicParts[4] === municipality &&
    SLUG.test(municipality ?? "") &&
    SLUG.test(topicParts[5] ?? "") &&
    topicTitles.length === 1 &&
    topicTitles[0]!.length === 2 &&
    topicTitles[0]![1] === topicTitles[0]![1]!.trim() &&
    topicTitles[0]![1]!.length >= 3 &&
    topicTitles[0]![1]!.length <= 120 &&
    !/[\u0000-\u001f\u007f]/.test(topicTitles[0]![1]!)
  ) {
    return { id: explicit!, title: topicTitles[0]![1]! };
  }
  if (
    (explicit === MARIENFELDER_TOPIC_ID || explicit === null) &&
    municipality === "roebel-mueritz" &&
    sourceCase === "marienfelder-strasse"
  )
    return { id: MARIENFELDER_TOPIC_ID, title: MARIENFELDER_TOPIC_TITLE };
  return null;
}

function caseBindingFor(event: NostrEvent): {
  municipalityId: string;
  sourceCaseId: string;
  canonicalCaseId: string;
} | null {
  const municipalityId = tagValue(event, "municipality");
  const sourceCaseId = tagValue(event, "case");
  const canonicalCaseId = tagValue(event, "stadtstack-case");
  return municipalityId && sourceCaseId && canonicalCaseId
    ? { municipalityId, sourceCaseId, canonicalCaseId }
    : null;
}

function authorFor(config: WorkbenchConfig, event: NostrEvent): PublicAuthor {
  const citizen = config.personas.find(
    (candidate) => candidate.publicKey === event.pubkey
  );
  if (citizen)
    return {
      name: citizen.name,
      kind: "citizen",
      pubkey: citizen.publicKey,
      synthetic: true,
    };
  if (event.pubkey === config.meckyPubkey)
    return {
      name: "Mecky",
      kind: "mecky",
      pubkey: event.pubkey,
      synthetic: false,
    };
  return {
    name: `Bürger:in ${event.pubkey.slice(0, 8)}`,
    kind: "citizen",
    pubkey: event.pubkey,
    synthetic: false,
  };
}

function isSyntheticCitizen(config: WorkbenchConfig, pubkey: string): boolean {
  return config.personas.some((candidate) => candidate.publicKey === pubkey);
}

function asArgument(
  config: WorkbenchConfig,
  event: NostrEvent
): PublicArgument | null {
  if (event.kind !== 1 || !verifyEvent(event)) return null;
  const rootId = tagValue(event, "argument-root");
  const stance = tagValue(event, "stance");
  const parentId =
    event.tags.find((tag) => tag[0] === "e" && tag[3] === "reply")?.[1] ?? null;
  const interactiveCivicRoot =
    JSON.stringify(event.tags) ===
      JSON.stringify([
        ["p", config.meckyPubkey],
        ["t", "stadtstack-civic-discussion"],
        ["municipality", "roebel-mueritz"],
        ["case", "marienfelder-strasse"],
        ["stadtstack-case", CASE_ID],
      ]) && /@mecky\b/i.test(event.content);
  if (interactiveCivicRoot && parentId === null) {
    return {
      id: event.id,
      parentId: null,
      rootId: event.id,
      stance: "root",
      author: authorFor(config, event),
      content: event.content,
      createdAt: new Date(event.created_at * 1_000).toISOString(),
    };
  }
  if (rootId === "self" && stance === "root" && parentId === null) {
    return {
      id: event.id,
      parentId: null,
      rootId: event.id,
      stance: "root",
      author: authorFor(config, event),
      content: event.content,
      createdAt: new Date(event.created_at * 1_000).toISOString(),
    };
  }
  if (!rootId || (stance !== "pro" && stance !== "con") || !parentId)
    return null;
  return {
    id: event.id,
    parentId,
    rootId,
    stance,
    author: authorFor(config, event),
    content: event.content,
    createdAt: new Date(event.created_at * 1_000).toISOString(),
  };
}

async function publishSeed(
  config: WorkbenchConfig,
  relay: RelayPort
): Promise<void> {
  const anna = config.personas[0]!;
  const omar = config.personas[1]!;
  // Keep the deterministic seed stable across every same-day restart. The
  // watcher recovers unanswered signed mentions across the same reviewed day.
  const base = Math.floor(Date.now() / 86_400_000) * 86_400 - 60;
  const profiles = [
    buildProfileEvent(
      secret(anna),
      { name: anna.name, about: "Synthetisches Röbel-Testprofil" },
      { createdAt: base }
    ),
    buildProfileEvent(
      secret(omar),
      { name: omar.name, about: "Synthetisches Röbel-Testprofil" },
      { createdAt: base + 1 }
    ),
  ];
  const standalonePost = buildNoteEvent(
    secret(omar),
    "Am Hafen war heute viel los. Danke an alle, die beim Aufraeumen geholfen haben.",
    { createdAt: base + 5 }
  );
  const root = buildNoteEvent(
    secret(anna),
    "Soll die Querung der Marienfelder Straße sicherer und nachvollziehbarer geplant werden? @Mecky, welche geprüften Informationen liegen dazu vor?",
    {
      createdAt: base + 10,
      tags: [
        ["p", config.meckyPubkey],
        ["t", "stadtstack-civic-discussion"],
        ["municipality", "roebel-mueritz"],
        ["case", "marienfelder-strasse"],
        ["topic", MARIENFELDER_TOPIC_ID],
        ["stadtstack-case", CASE_ID],
        ["stance", "root"],
        ["argument-root", "self"],
      ],
    }
  );
  const graphRootId = root.id;
  const pro = buildNoteEvent(
    secret(omar),
    "Pro: Eine klar markierte und gut einsehbare Querung kann die Sichtbarkeit für alle Verkehrsteilnehmenden verbessern.",
    {
      createdAt: base + 20,
      tags: [
        ["e", graphRootId, "", "root"],
        ["e", graphRootId, "", "reply"],
        ["argument-root", graphRootId],
        ["stance", "pro"],
        ["t", "stadtstack-argument"],
      ],
    }
  );
  const con = buildNoteEvent(
    secret(anna),
    "Contra: Eine Einzelmaßnahme könnte falsche Sicherheit erzeugen; Geschwindigkeit, Beleuchtung und Wegeführung müssen gemeinsam geprüft werden.",
    {
      createdAt: base + 30,
      tags: [
        ["e", graphRootId, "", "root"],
        ["e", graphRootId, "", "reply"],
        ["argument-root", graphRootId],
        ["stance", "con"],
        ["t", "stadtstack-argument"],
      ],
    }
  );
  const sourcePost = buildNoteEvent(
    secret(omar),
    "Mir ist aufgefallen, dass viele Hinweise zur Marienfelder Straße im Feed verstreut bleiben.",
    { createdAt: base + 35 }
  );
  const secondRoot = buildCivicPromotionEvent(secret(omar), {
    sourcePost,
    municipalityId: "roebel-mueritz",
    sourceCaseId: "marienfelder-strasse",
    canonicalCaseId: CASE_ID,
    topicId: MARIENFELDER_TOPIC_ID,
    agentPubkey: config.meckyPubkey,
    content:
      "@Mecky, welche geprueften Informationen helfen, die verstreuten Hinweise gemeinsam abzuwägen?",
    createdAt: base + 40,
  });
  for (const seeded of [
    ...profiles,
    standalonePost,
    root,
    pro,
    con,
    sourcePost,
    secondRoot,
  ]) {
    const result = await relay.publish(seeded);
    if (!result.ok) throw new Error(`citizen_relay_${result.message}`);
  }
}

async function control(
  config: WorkbenchConfig,
  fetcher: typeof globalThis.fetch,
  path: string,
  value: unknown
): Promise<unknown> {
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
    const responseValue = (await response.json()) as unknown;
    if (!response.ok) throw new Error(`control_${response.status}`);
    return responseValue;
  } finally {
    clearTimeout(timer);
  }
}

async function currentCaseVersion(
  config: WorkbenchConfig,
  fetcher: typeof globalThis.fetch
): Promise<number> {
  const projection = await control(config, fetcher, "/v1/e2e/view", {
    profile: "administration",
  });
  if (
    !projection ||
    typeof projection !== "object" ||
    Array.isArray(projection) ||
    !Number.isSafeInteger(
      (projection as Record<string, unknown>).caseVersion
    ) ||
    Number((projection as Record<string, unknown>).caseVersion) < 2
  )
    throw new Error("control_case_version_invalid");
  return Number((projection as Record<string, unknown>).caseVersion);
}

async function admitToCitizenRelay(
  config: WorkbenchConfig,
  fetcher: typeof globalThis.fetch,
  pubkey: string
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetcher(
      `${config.citizenRelayUrl.replace(/^ws:/, "http:")}/internal/admissions`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.citizenRelayAdmissionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          schemaVersion: "roebel_staging_relay_admission_v1",
          pubkey,
        }),
        signal: controller.signal,
      }
    );
    if (!response.ok)
      throw new Error(`citizen_relay_admission_${response.status}`);
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

export async function startWorkbench(
  config: WorkbenchConfig,
  dependencies: WorkbenchDependencies = {}
): Promise<RunningWorkbench> {
  const citizenRelay =
    dependencies.citizenRelay ?? nodeRelay(config.citizenRelayUrl);
  const agentRelay = dependencies.agentRelay ?? nodeRelay(config.agentRelayUrl);
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const verifyWalletSignature =
    dependencies.verifyWalletSignature ??
    createGnosisWalletVerifier({ rpcUrl: config.gnosisRpcUrl })
      .verifyWalletSignature;
  const admitPubkey =
    dependencies.admitPubkey ??
    ((pubkey: string) => admitToCitizenRelay(config, fetcher, pubkey));
  await publishSeed(config, citizenRelay);
  const server: Server = createServer((request, response) => {
    void (async () => {
      const requestedPath = request.url ?? "";
      const prefixed =
        requestedPath === STAGING_PREFIX ||
        requestedPath.startsWith(`${STAGING_PREFIX}/`);
      const path = prefixed
        ? requestedPath.slice(STAGING_PREFIX.length) || "/"
        : requestedPath;
      if (request.method === "GET" && (path === "/" || path === "")) {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy":
            "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
        });
        response.end(HTML);
        return;
      }
      if (request.method === "GET" && path === "/healthz")
        return json(response, 200, {
          status: "ok",
          mode: "isolated-staging-e2e",
        });
      if (request.method === "GET" && path === "/api/config")
        return json(response, 200, {
          schemaVersion: "roebel_e2e_workbench_config_v1",
          personas: config.personas.map(({ id, name, publicKey }) => ({
            id,
            name,
            publicKey,
          })),
          meckyPubkey: config.meckyPubkey,
          authorityBinding: "none",
        });
      if (request.method === "GET" && path === "/api/feed") {
        const [events, agentEvents] = await Promise.all([
          citizenRelay
            .query([{ kinds: [1], limit: 100 }])
            .then((entries) => entries.filter(verifyEvent)),
          agentRelay
            .query([{ kinds: [1], authors: [config.meckyPubkey], limit: 100 }])
            .then((entries) => entries.filter(verifyEvent)),
        ]);
        const argumentsList = events
          .map((entry) => asArgument(config, entry))
          .filter((entry): entry is PublicArgument => entry !== null);
        const promotionBySourcePost = new Map<
          string,
          { discussionId: string; topicId: string }
        >();
        for (const entry of events) {
          const sourcePostId = tagValue(entry, "source-post");
          const topic = topicFor(entry);
          if (sourcePostId && topic)
            promotionBySourcePost.set(sourcePostId, {
              discussionId: entry.id,
              topicId: topic.id,
            });
        }
        const ordinaryPosts = events
          .filter(
            (entry) =>
              entry.kind === 1 &&
              verifyEvent(entry) &&
              !entry.tags.some((tag) => tag[0] === "e") &&
              asArgument(config, entry) === null
          )
          .map((entry) => ({
            id: entry.id,
            entryType: "post" as const,
            event: entry,
            author: authorFor(config, entry),
            content: entry.content,
            createdAt: new Date(entry.created_at * 1_000).toISOString(),
            replyCount: 0,
            meckyMentioned: entry.tags.some(
              (tag) => tag[0] === "p" && tag[1] === config.meckyPubkey
            ),
            meckyAnswered: agentEvents.some(
              (candidate) =>
                candidate.pubkey === config.meckyPubkey &&
                isAgentEvent(candidate) &&
                candidate.tags.some(
                  (tag) =>
                    tag[0] === "e" && tag[1] === entry.id && tag[3] === "reply"
                )
            ),
            promotedDiscussionId:
              promotionBySourcePost.get(entry.id)?.discussionId ?? null,
            promotedTopicId:
              promotionBySourcePost.get(entry.id)?.topicId ?? null,
            sourceAppPostId: sourceAppPostIdFor(entry),
            synthetic: isSyntheticCitizen(config, entry.pubkey),
          }));
        const roots = argumentsList
          .filter((entry) => entry.stance === "root")
          .flatMap((entry) => {
            const source = events.find(
              (candidate) => candidate.id === entry.id
            );
            if (!source) return [];
            const topic = topicFor(source);
            if (!topic) return [];
            return [
              {
                id: entry.id,
                author: entry.author,
                content: entry.content,
                createdAt: entry.createdAt,
                replyCount: argumentsList.filter(
                  (candidate) =>
                    candidate.rootId === entry.id && candidate.id !== entry.id
                ).length,
                meckyMentioned: source.tags.some(
                  (tag) => tag[0] === "p" && tag[1] === config.meckyPubkey
                ),
                meckyAnswered: agentEvents.some(
                  (candidate) =>
                    candidate.pubkey === config.meckyPubkey &&
                    isAgentEvent(candidate) &&
                    candidate.tags.some(
                      (tag) =>
                        tag[0] === "e" &&
                        tag[1] === entry.id &&
                        tag[3] === "reply"
                    )
                ),
                topicId: topic.id,
                topicTitle: topic.title,
                synthetic: isSyntheticCitizen(config, entry.author.pubkey),
              },
            ];
          });
        const grouped = new Map<string, typeof roots>();
        for (const entry of roots)
          grouped.set(entry.topicId, [
            ...(grouped.get(entry.topicId) ?? []),
            entry,
          ]);
        const topics = [...grouped.values()].map((discussions) => {
          const ordered = [...discussions].sort(
            (a, b) =>
              Number(b.meckyAnswered) - Number(a.meckyAnswered) ||
              b.replyCount - a.replyCount ||
              Number(b.meckyMentioned) - Number(a.meckyMentioned) ||
              a.createdAt.localeCompare(b.createdAt) ||
              a.id.localeCompare(b.id)
          );
          const primary = ordered[0]!;
          const meckyAnswerCount = agentEvents.filter(
            (candidate) =>
              candidate.pubkey === config.meckyPubkey &&
              isAgentEvent(candidate) &&
              discussions.some((discussion) =>
                candidate.tags.some(
                  (tag) =>
                    tag[0] === "e" &&
                    tag[1] === discussion.id &&
                    tag[3] === "reply"
                )
              )
          ).length;
          return {
            ...primary,
            entryType: "topic" as const,
            lastActivityAt: discussions
              .map((entry) => entry.createdAt)
              .sort()
              .at(-1)!,
            replyCount: discussions.reduce(
              (sum, entry) => sum + entry.replyCount,
              0
            ),
            meckyMentioned: discussions.some((entry) => entry.meckyMentioned),
            meckyAnswered: discussions.some((entry) => entry.meckyAnswered),
            discussionCount: discussions.length,
            discussionIds: discussions.map((entry) => entry.id).sort(),
            sourcePostIds: discussions
              .flatMap((discussion) => {
                const source = events.find(
                  (candidate) => candidate.id === discussion.id
                );
                return source
                  ? source.tags
                      .filter((tag) => tag[0] === "source-post")
                      .map((tag) => tag[1]!)
                  : [];
              })
              .filter((id, index, all) => all.indexOf(id) === index)
              .sort(),
            activityCount:
              discussions.length +
              discussions.reduce((sum, entry) => sum + entry.replyCount, 0) +
              meckyAnswerCount,
          };
        });
        return json(response, 200, {
          schemaVersion: "roebel_staging_mixed_feed_v1",
          posts: [...ordinaryPosts, ...topics].sort((a, b) =>
            ("lastActivityAt" in b
              ? b.lastActivityAt
              : b.createdAt
            ).localeCompare(
              "lastActivityAt" in a ? a.lastActivityAt : a.createdAt
            )
          ),
          authorityBinding: "none",
        });
      }
      if (request.method === "GET" && path.startsWith("/api/thread?root=")) {
        const rootId =
          new URL(path, "http://workbench").searchParams.get("root") ?? "";
        if (!HEX64.test(rootId))
          return json(response, 400, { error: "root_invalid" });
        const [citizenEvents, meckyEvents] = await Promise.all([
          citizenRelay.query([{ kinds: [1], limit: 200 }]),
          agentRelay.query([{ kinds: [1], "#e": [rootId], limit: 20 }]),
        ]);
        const argumentsList = citizenEvents
          .filter(verifyEvent)
          .map((entry) => asArgument(config, entry))
          .filter(
            (entry): entry is PublicArgument =>
              entry !== null && entry.rootId === rootId
          );
        const rootEvent =
          citizenEvents
            .filter(verifyEvent)
            .find(
              (entry) =>
                entry.id === rootId &&
                asArgument(config, entry)?.stance === "root"
            ) ?? null;
        const sourceEvent = rootEvent
          ? citizenEvents
              .filter(verifyEvent)
              .find(
                (entry) => entry.id === tagValue(rootEvent, "source-post"),
              ) ?? null
          : null;
        const meckyReply =
          meckyEvents
            .filter(verifyEvent)
            .sort((a, b) => b.created_at - a.created_at)[0] ?? null;
        return json(response, 200, {
          schemaVersion: "roebel_staging_argument_thread_v1",
          arguments: argumentsList.sort(
            (a, b) =>
              a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
          ),
          events: Object.fromEntries(
            citizenEvents
              .filter(verifyEvent)
              .filter((entry) =>
                argumentsList.some((argument) => argument.id === entry.id),
              )
              .map((entry) => [entry.id, entry]),
          ),
          rootEvent,
          sourceAppPostId: sourceEvent
            ? sourceAppPostIdFor(sourceEvent)
            : null,
          topic: rootEvent ? topicFor(rootEvent) : null,
          caseBinding: rootEvent ? caseBindingFor(rootEvent) : null,
          mecky: meckyReply
            ? {
                event: meckyReply,
                author: authorFor(config, meckyReply),
                evidenceRefs: meckyReply.tags
                  .filter((tag) => tag[0] === "evidence")
                  .map((tag) => ({ digest: tag[1], url: tag[2] })),
              }
            : null,
          authorityBinding: "none",
        });
      }
      if (request.method === "GET" && path.startsWith("/api/reply?parent=")) {
        const parent =
          new URL(path, "http://workbench").searchParams.get("parent") ?? "";
        if (!HEX64.test(parent))
          return json(response, 400, { error: "parent_invalid" });
        const events = await agentRelay.query([
          {
            kinds: [1],
            authors: [config.meckyPubkey],
            "#e": [parent],
            limit: 5,
          },
        ]);
        const answer =
          events
            .filter(verifyEvent)
            .sort((a, b) => b.created_at - a.created_at)[0] ?? null;
        return json(
          response,
          200,
          answer ? { status: "answered", event: answer } : null
        );
      }
      if (
        request.method !== "POST" ||
        request.headers["x-stadtstack-e2e"] !== "1"
      )
        return json(response, 404, { error: "not_found" });
      const body = await readBody(request);
      if (path === "/api/session/admit") {
        if (
          !exactRecord(body, [
            "schemaVersion",
            "credential",
            "statement",
            "walletSignature",
            "bindingEvent",
          ]) ||
          body.schemaVersion !== "roebel_citizen_admission_proof_v1" ||
          !exactRecord(body.credential, ["kind", "address", "chainId"]) ||
          (body.credential.kind !== "thirdweb_smart_account" &&
            body.credential.kind !== "passkey_safe") ||
          typeof body.credential.address !== "string" ||
          !ADDRESS.test(body.credential.address) ||
          body.credential.chainId !== 100 ||
          typeof body.statement !== "string" ||
          typeof body.walletSignature !== "string" ||
          !WALLET_SIGNATURE.test(body.walletSignature) ||
          (body.walletSignature.length - 2) % 2 !== 0
        )
          throw new Error("citizen_admission_invalid");
        const bindingEvent = event(body.bindingEvent);
        const binding = verifyBindingEvent(
          bindingEvent,
          body.credential.address
        );
        if (!binding.valid)
          throw new Error(`citizen_binding_${binding.reason}`);
        const expectedStatement = bindingStatement({
          account: body.credential.address,
          npub: binding.npub,
        });
        if (
          body.statement !== expectedStatement ||
          bindingEvent.content !== expectedStatement
        ) {
          throw new Error("citizen_binding_statement_mismatch");
        }
        if (
          !(await verifyWalletSignature({
            address: body.credential.address,
            message: expectedStatement,
            signature: body.walletSignature,
          }))
        )
          throw new Error("citizen_wallet_signature_invalid");
        await admitPubkey(binding.pubkey);
        return json(response, 200, {
          status: "admitted",
          pubkey: binding.pubkey,
          assurance: "staging_credential_control",
          authorityBinding: "none",
        });
      }
      if (path === "/api/signed-event") {
        if (
          !exactRecord(body, ["intent", "event"]) ||
          (body.intent !== "post" &&
            body.intent !== "promotion" &&
            body.intent !== "argument")
        )
          throw new Error("signed_event_invalid");
        const signed = event(body.event);
        if (
          signed.kind !== 1 ||
          signed.content !== signed.content.trim() ||
          signed.content.length < 1 ||
          signed.content.length > 2_000
        ) {
          throw new Error("signed_event_invalid");
        }
        if (body.intent === "post") {
          const sourceAppPostTags = signed.tags.filter(
            (tag) => tag[0] === "source-app-post"
          );
          if (
            signed.tags.length > 9 ||
            sourceAppPostTags.length > 1 ||
            !signed.tags.every(
              (tag) =>
                (tag.length === 2 &&
                  tag[0] === "p" &&
                  typeof tag[1] === "string" &&
                  HEX64.test(tag[1])) ||
                (tag.length === 2 &&
                  tag[0] === "source-app-post" &&
                  typeof tag[1] === "string" &&
                  UUID.test(tag[1]))
            )
          )
            throw new Error("signed_post_tags_invalid");
        } else if (body.intent === "promotion") {
          const sourcePostId = tagValue(signed, "source-post");
          if (
            !sourcePostId ||
            !HEX64.test(sourcePostId) ||
            topicFor(signed) === null ||
            asArgument(config, signed)?.stance !== "root" ||
            !signed.tags.some(
              (tag) => tag[0] === "p" && tag[1] === config.meckyPubkey
            )
          )
            throw new Error("signed_promotion_invalid");
          const sourcePost = (
            await citizenRelay.query([
              {
                ids: [sourcePostId],
                authors: [signed.pubkey],
                kinds: [1],
                limit: 1,
              },
            ])
          )
            .filter(verifyEvent)
            .find(
              (candidate) =>
                candidate.id === sourcePostId &&
                candidate.pubkey === signed.pubkey
            );
          if (
            !sourcePost ||
            sourcePost.tags.some(
              (tag) => tag[0] === "source-post" || tag[0] === "argument-root"
            ) ||
            signed.created_at <= sourcePost.created_at
          )
            throw new Error("signed_promotion_source_invalid");
        } else {
          const rootId = tagValue(signed, "argument-root");
          const parentId =
            signed.tags.find(
              (tag) => tag[0] === "e" && tag[3] === "reply",
            )?.[1] ?? null;
          const relatedEvents =
            rootId && parentId
              ? (await citizenRelay.query([
                  { ids: [rootId, parentId], kinds: [1], limit: 2 },
                ])).filter(verifyEvent)
              : [];
          const rootEvent = relatedEvents.find(
            (candidate) => candidate.id === rootId,
          );
          const parentEvent = relatedEvents.find(
            (candidate) => candidate.id === parentId,
          );
          const rootArgument = rootEvent ? asArgument(config, rootEvent) : null;
          const parentArgument = parentEvent
            ? asArgument(config, parentEvent)
            : null;
          const rootTopic = rootEvent ? topicFor(rootEvent) : null;
          if (
            !rootId ||
            !parentId ||
            !rootEvent ||
            !parentEvent ||
            rootArgument?.stance !== "root" ||
            parentArgument?.rootId !== rootId ||
            !rootTopic ||
            signed.created_at <= rootEvent.created_at ||
            signed.created_at <= parentEvent.created_at ||
            JSON.stringify(signed.tags) !==
              JSON.stringify([
                ["e", rootId, "", "root"],
                ["e", parentId, "", "reply"],
                ["argument-root", rootId],
                ["stance", tagValue(signed, "stance")],
                ["t", "stadtstack-argument"],
                ["municipality", "roebel-mueritz"],
                ["topic", rootTopic.id],
              ]) ||
            (tagValue(signed, "stance") !== "pro" &&
              tagValue(signed, "stance") !== "con")
          ) {
            throw new Error("signed_argument_invalid");
          }
        }
        const published = await citizenRelay.publish(signed);
        if (!published.ok)
          throw new Error(`citizen_relay_${published.message}`);
        return json(response, 200, {
          status:
            body.intent === "promotion" ? "promoted" : "published",
          event: signed,
          authorityBinding: "none",
        });
      }
      if (path === "/api/post") {
        if (
          !exactRecord(body, ["personaId", "content"]) ||
          typeof body.content !== "string" ||
          !body.content.trim() ||
          body.content.length > 1_000
        )
          throw new Error("post_invalid");
        const actor = persona(config, body.personaId);
        const signed = buildNoteEvent(secret(actor), body.content.trim());
        const published = await citizenRelay.publish(signed);
        if (!published.ok)
          throw new Error(`citizen_relay_${published.message}`);
        return json(response, 200, {
          status: "published",
          persona: {
            id: actor.id,
            name: actor.name,
            publicKey: actor.publicKey,
          },
          event: signed,
          authorityBinding: "none",
        });
      }
      if (path === "/api/promote") {
        if (
          !exactRecord(body, [
            "personaId",
            "sourcePostId",
            "topicId",
            "question",
          ]) ||
          typeof body.sourcePostId !== "string" ||
          !HEX64.test(body.sourcePostId) ||
          body.topicId !== MARIENFELDER_TOPIC_ID ||
          typeof body.question !== "string" ||
          !body.question.trim() ||
          body.question.length > 1_000
        )
          throw new Error("promotion_invalid");
        const actor = persona(config, body.personaId);
        const candidates = (
          await citizenRelay.query([
            { kinds: [1], authors: [actor.publicKey], limit: 100 },
          ])
        ).filter(verifyEvent);
        const sourcePost = candidates.find(
          (entry) => entry.id === body.sourcePostId
        );
        if (!sourcePost) throw new Error("promotion_source_missing");
        const existing = candidates.find(
          (entry) =>
            entry.pubkey === actor.publicKey &&
            tagValue(entry, "source-post") === sourcePost.id &&
            tagValue(entry, "topic") === MARIENFELDER_TOPIC_ID &&
            asArgument(config, entry)?.stance === "root"
        );
        if (existing) {
          return json(response, 200, {
            status: "already_promoted",
            sourcePostId: sourcePost.id,
            topicId: MARIENFELDER_TOPIC_ID,
            event: existing,
            authorityBinding: "none",
          });
        }
        const signed = buildCivicPromotionEvent(secret(actor), {
          sourcePost,
          municipalityId: "roebel-mueritz",
          sourceCaseId: "marienfelder-strasse",
          canonicalCaseId: CASE_ID,
          topicId: MARIENFELDER_TOPIC_ID,
          agentPubkey: config.meckyPubkey,
          content: `@Mecky, ${body.question.trim()}`,
          createdAt: Math.max(
            Math.floor(Date.now() / 1_000),
            sourcePost.created_at + 1
          ),
        });
        const published = await citizenRelay.publish(signed);
        if (!published.ok)
          throw new Error(`citizen_relay_${published.message}`);
        return json(response, 200, {
          status: "promoted",
          sourcePostId: sourcePost.id,
          topicId: MARIENFELDER_TOPIC_ID,
          event: signed,
          authorityBinding: "none",
        });
      }
      if (path === "/api/discussion") {
        if (
          !exactRecord(body, ["personaId", "question"]) ||
          typeof body.question !== "string" ||
          !body.question.trim() ||
          body.question.length > 1_000
        )
          throw new Error("discussion_invalid");
        const actor = persona(config, body.personaId);
        const signed = buildCivicDiscussionEvent(
          Uint8Array.from(Buffer.from(actor.secretKeyHex, "hex")),
          {
            municipalityId: "roebel-mueritz",
            sourceCaseId: "marienfelder-strasse",
            canonicalCaseId: CASE_ID,
            agentPubkey: config.meckyPubkey,
            content: `@Mecky, ${body.question.trim()}`,
          }
        );
        const published = await citizenRelay.publish(signed);
        if (!published.ok)
          throw new Error(`citizen_relay_${published.message}`);
        return json(response, 200, {
          status: "published",
          persona: {
            id: actor.id,
            name: actor.name,
            publicKey: actor.publicKey,
          },
          event: signed,
        });
      }
      if (path === "/api/claim") {
        if (
          !exactRecord(body, [
            "personaId",
            "rootEventId",
            "parentEventId",
            "stance",
            "content",
          ]) ||
          typeof body.rootEventId !== "string" ||
          !HEX64.test(body.rootEventId) ||
          typeof body.parentEventId !== "string" ||
          !HEX64.test(body.parentEventId) ||
          (body.stance !== "pro" && body.stance !== "con") ||
          typeof body.content !== "string" ||
          !body.content.trim() ||
          body.content.length > 1_000
        )
          throw new Error("claim_invalid");
        const relatedEvents = (await citizenRelay.query([
          {
            ids: [body.rootEventId, body.parentEventId],
            kinds: [1],
            limit: 2,
          },
        ])).filter(verifyEvent);
        const rootEvent = relatedEvents.find(
          (candidate) => candidate.id === body.rootEventId,
        );
        const parentEvent = relatedEvents.find(
          (candidate) => candidate.id === body.parentEventId,
        );
        const rootArgument = rootEvent ? asArgument(config, rootEvent) : null;
        const parentArgument = parentEvent
          ? asArgument(config, parentEvent)
          : null;
        const rootTopic = rootEvent ? topicFor(rootEvent) : null;
        const rootCaseBinding = rootEvent ? caseBindingFor(rootEvent) : null;
        if (
          !rootEvent ||
          !parentEvent ||
          rootArgument?.stance !== "root" ||
          parentArgument?.rootId !== body.rootEventId ||
          !rootTopic
        ) {
          throw new Error("claim_thread_invalid");
        }
        const actor = persona(config, body.personaId);
        const signed = buildNoteEvent(secret(actor), body.content.trim(), {
          tags: [
            ["e", body.rootEventId, "", "root"],
            ["e", body.parentEventId, "", "reply"],
            ["argument-root", body.rootEventId],
            ["stance", body.stance],
            ["t", "stadtstack-argument"],
            ["municipality", "roebel-mueritz"],
            ["topic", rootTopic.id],
            ...(rootCaseBinding
              ? [
                  ["case", rootCaseBinding.sourceCaseId],
                  ["stadtstack-case", rootCaseBinding.canonicalCaseId],
                ]
              : []),
          ],
        });
        const published = await citizenRelay.publish(signed);
        if (!published.ok)
          throw new Error(`citizen_relay_${published.message}`);
        return json(response, 200, {
          status: "published",
          event: signed,
          authorityBinding: "none",
        });
      }
      if (path === "/api/suggestion") {
        if (
          !exactRecord(body, [
            "personaId",
            "discussion",
            "answer",
            "title",
            "summary",
          ]) ||
          typeof body.title !== "string" ||
          typeof body.summary !== "string"
        )
          throw new Error("suggestion_invalid");
        const actor = persona(config, body.personaId);
        const discussion = event(body.discussion);
        const answer = event(body.answer);
        if (
          discussion.pubkey !== actor.publicKey ||
          answer.pubkey !== config.meckyPubkey
        )
          throw new Error("suggestion_actor_mismatch");
        const suggestion = buildCitizenSignedSuggestion(
          Uint8Array.from(Buffer.from(actor.secretKeyHex, "hex")),
          {
            binding: {
              municipalityId: "roebel-mueritz",
              sourceCaseId: "marienfelder-strasse",
              canonicalCaseId: CASE_ID,
            },
            agentPubkey: config.meckyPubkey,
            sourceDiscussion: discussion,
            sourceAnswer: answer,
            title: body.title,
            summary: body.summary,
            createdAt: Math.floor(Date.now() / 1_000),
          }
        );
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
        if (!published.ok)
          throw new Error(`citizen_relay_${published.message}`);
        return json(response, 200, {
          status: "signed",
          suggestion,
          event: suggestionEvent,
        });
      }
      if (path === "/api/admit") {
        if (!exactRecord(body, ["discussion", "answer", "suggestion"]))
          throw new Error("admission_invalid");
        const expectedCaseVersion = await currentCaseVersion(config, fetcher);
        return json(
          response,
          200,
          await control(config, fetcher, "/v1/nostr/suggestions/admit", {
            expectedCaseVersion,
            sourceDiscussion: event(body.discussion),
            sourceAnswer: event(body.answer),
            signedSuggestion: body.suggestion as CitizenSignedSuggestionV1,
          })
        );
      }
      if (path === "/api/complete") {
        if (!exactRecord(body, [])) throw new Error("complete_invalid");
        return json(
          response,
          200,
          await control(config, fetcher, "/v1/e2e/complete", {})
        );
      }
      if (path === "/api/view") {
        if (
          !exactRecord(body, ["profile"]) ||
          !["public", "administration", "council"].includes(
            String(body.profile)
          )
        )
          throw new Error("view_invalid");
        return json(
          response,
          200,
          await control(config, fetcher, "/v1/e2e/view", {
            profile: body.profile,
          })
        );
      }
      return json(response, 404, { error: "not_found" });
    })().catch((error: unknown) => {
      if (!response.writableEnded)
        json(response, error instanceof SyntaxError ? 400 : 422, {
          error: error instanceof Error ? error.message : "workbench_failed",
        });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("workbench_listener_invalid");
  return {
    port: address.port,
    close: async () => {
      citizenRelay.close();
      if (agentRelay !== citizenRelay) agentRelay.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}
