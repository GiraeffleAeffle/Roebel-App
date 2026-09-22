import type { CitizenSession } from "../citizen-session/session";
import { getAddress } from "viem";

export const STAGING_WORKSPACE_ISSUER = "https://roebel-id.staging.agentcart.eu";
export const STAGING_WORKSPACE_APP = "https://roebel-web.staging.agentcart.eu";
type Status = "ready" | "waiting" | "signing" | "sent" | "failed";
type Opener = { postMessage(message: unknown, targetOrigin: string): void };

/** The app signs one fixed issuer login after a user gesture. No caller can
 * choose a message, issuer, chain, credential or redirect through this channel. */
export function createStagingWorkspaceLogin(input: {
  session: CitizenSession; opener: Opener; appOrigin: string;
  onStatus(status: Status): void; now?: () => number;
}) {
  if (input.appOrigin !== STAGING_WORKSPACE_APP || input.session.snapshot.credential.chainId !== 100) {
    throw Error("workspace_login_unavailable");
  }
  const credentialAddress = input.session.snapshot.credential.address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(credentialAddress)) throw Error("workspace_login_unavailable");
  const address = getAddress(credentialAddress);
  const now = input.now ?? Date.now;
  let active = true, status: Status = "ready";
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = (next: Status) => {
    clearTimeout(timer);
    status = next; if (active) input.onStatus(next);
  };
  return {
    start() {
      if (!active || (status !== "ready" && status !== "failed")) return;
      attempt++;
      update("waiting");
      timer = setTimeout(() => { if (active && status === "waiting") update("failed"); }, 15_000);
      try { input.opener.postMessage({ schemaVersion: "roebel_workspace_login_ready_v1" }, STAGING_WORKSPACE_ISSUER); }
      catch { update("failed"); }
    },
    async receive(event: { origin: string; source: unknown; data: unknown }) {
      if (!active || status !== "waiting" || event.origin !== STAGING_WORKSPACE_ISSUER || event.source !== input.opener) return;
      const value = event.data;
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const request = value as Record<string, unknown>;
      if (request.schemaVersion !== "roebel_workspace_login_request_v1") return;
      if (Object.keys(request).sort().join() !== "nonce,requestId,schemaVersion" ||
        typeof request.requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(request.requestId) ||
        typeof request.nonce !== "string" || !/^[A-Za-z0-9]{8,128}$/.test(request.nonce)) {
        update("failed"); return;
      }
      update("signing");
      const issuedAt = now(), expiresAt = issuedAt + 120_000;
      const signingAttempt = attempt;
      const isCurrent = () => active && attempt === signingAttempt && status === "signing";
      timer = setTimeout(() => { if (isCurrent()) update("failed"); }, expiresAt - now());
      const message = ["roebel-id.staging.agentcart.eu wants you to sign in with your Ethereum account:", address, "",
        "Anmeldung im Roebel Testbetrieb", "", `URI: ${STAGING_WORKSPACE_ISSUER}`, "Version: 1", "Chain ID: 100",
        `Nonce: ${request.nonce}`, `Issued At: ${new Date(issuedAt).toISOString()}`,
        `Expiration Time: ${new Date(expiresAt).toISOString()}`].join("\n");
      try {
        const signature = await input.session.signMessage(message);
        if (!isCurrent()) return;
        if (now() >= expiresAt) { update("failed"); return; }
        input.opener.postMessage({ schemaVersion: "roebel_workspace_login_response_v1", requestId: request.requestId,
          message, signature }, STAGING_WORKSPACE_ISSUER);
        update("sent");
      } catch { if (isCurrent()) update("failed"); }
    },
    dispose() { active = false; clearTimeout(timer); },
  };
}
