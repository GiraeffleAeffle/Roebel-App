import assert from "node:assert/strict";
import test from "node:test";

import { buildNoteEvent } from "@netizen-labs/nostr";
import { WebSocketServer } from "ws";

import { createNodeRelayClient } from "../src/node-relay-client";

test("the Node CLI relay transport publishes without a global WebSocket", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("unexpected websocket address");
  server.on("connection", (socket) => {
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as unknown[];
      if (message[0] === "EVENT") {
        const event = message[1] as { id: string };
        socket.send(JSON.stringify(["OK", event.id, true, "accepted"]));
      }
    });
  });

  const client = createNodeRelayClient(`ws://127.0.0.1:${address.port}`);
  try {
    const event = buildNoteEvent(new Uint8Array(32).fill(23), "transport probe", { createdAt: 1_786_464_000 });
    assert.deepEqual(await client.publish(event), { ok: true, message: "accepted" });
  } finally {
    client.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
