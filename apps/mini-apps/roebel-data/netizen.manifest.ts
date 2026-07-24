import type { MiniAppManifest } from "@netizen-labs/miniapp-sdk";
import { isMarienfelderPublicDemo } from "./src/lib/publicDemoMode";

/**
 * Röbel Circles — the Netizen mini app registry entry.
 *
 * The first-party proof-of-concept: the town's on-chain economy dashboard
 * (Town / Economy / Governance) plus citizen tools (invite neighbours, create
 * event QR codes). Ported from the standalone Circles mini app.
 *
 * Permissions (only what the app actually uses):
 *  - wallet   → EIP-1193 signing for the invite + event-QR flows (host confirm sheet)
 *  - circles  → read the connected user's Röbel-Münzen balance
 *  - rewards  → grantReward when a citizen shares the town / sends an invite
 *  - share    → native share sheet for the referral link
 */
const fullMiniAppManifest: MiniAppManifest = {
  slug: "roebel-data",
  name: "Röbel Circles",
  iconUrl: "https://mini.roebel.app/roebel-data/icon-1024.png", // 1024×1024 PNG
  homeUrl: "https://mini.roebel.app/roebel-data",
  description:
    "Die Wirtschaft von Röbel, live on-chain: Röbel-Münzen-Vorrat, Deckung, Vertrauensnetz und Governance — plus Werkzeuge, um Nachbarn einzuladen und Event-QR-Codes zu erstellen.",
  category: "community",
  tags: ["röbel", "wirtschaft", "münzen", "governance", "einladen"],
  screenshots: [],
  permissions: ["wallet", "circles", "rewards", "share"],
  primaryColor: "#00498B",
};

/**
 * A standalone demo build never needs host wallet, rewards, Circles or share
 * capabilities. Keeping the manifest equally narrow matters if the preview is
 * ever loaded through a Mini App host rather than directly in a browser.
 */
const publicDemoManifest: MiniAppManifest = {
  slug: "roebel-data-stadtstack-demo",
  name: "Röbel Data · Stadtstack-Demo",
  iconUrl: fullMiniAppManifest.iconUrl,
  homeUrl: fullMiniAppManifest.homeUrl,
  description:
    "Öffentliche, synthetische Stadtstack-Demo zur Marienfelder Straße. Keine Abstimmung, Gemeinschaftskasse oder amtliche Entscheidung.",
  category: "governance",
  tags: ["röbel", "stadtstack", "demo", "mitbestimmung"],
  screenshots: [],
  permissions: [],
  primaryColor: "#00498B",
};

export const manifest = isMarienfelderPublicDemo(
  process.env.NEXT_PUBLIC_STADTSTACK_PUBLIC_DEMO_MODE,
)
  ? publicDemoManifest
  : fullMiniAppManifest;

export default manifest;
