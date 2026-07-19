import assert from "node:assert/strict";
import test from "node:test";

import { createClient } from "./client";
import { NETIZEN_PROTOCOL, type BridgeRequest, type BridgeResponse } from "./types";

type MessageListener = (event: MessageEvent) => void;

function installClientWindow(
  configure: (dispatch: (data: unknown) => void) => {
    parent?: { postMessage(message: unknown, targetOrigin: string): void };
    ReactNativeWebView?: { postMessage(data: string): void };
  },
) {
  const listeners = new Set<MessageListener>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const dispatch = (data: unknown) => {
    for (const listener of listeners) listener({ data } as MessageEvent);
  };
  const transport = configure(dispatch);
  const fakeWindow = {
    addEventListener(type: string, listener: MessageListener) {
      if (type === "message") listeners.add(listener);
    },
    ...transport,
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
  return {
    restore() {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    },
  };
}

function responseFor(request: BridgeRequest): BridgeResponse {
  return {
    netizen: NETIZEN_PROTOCOL,
    id: request.id,
    result: request.method === "bridge.hello" ? { ok: true } : undefined,
  };
}

test("the iframe client retries its handshake and then uses the real host", async () => {
  const methods: string[] = [];
  let helloAttempts = 0;
  const harness = installClientWindow((dispatch) => ({
    parent: {
      postMessage(message) {
        const request = message as BridgeRequest;
        methods.push(request.method);
        if (request.method === "bridge.hello") {
          helloAttempts += 1;
          if (helloAttempts === 1) return;
        }
        queueMicrotask(() => dispatch(responseFor(request)));
      },
    },
  }));

  try {
    const sdk = createClient();
    await sdk.isReady;
    await sdk.actions.ready();

    assert.equal(sdk.isMockMode(), false);
    assert.equal(helloAttempts, 2);
    assert.deepEqual(methods, ["bridge.hello", "bridge.hello", "actions.ready"]);
  } finally {
    harness.restore();
  }
});

test("the Expo client serializes requests and accepts injected JSON replies", async () => {
  const methods: string[] = [];
  const harness = installClientWindow((dispatch) => ({
    ReactNativeWebView: {
      postMessage(data) {
        const request = JSON.parse(data) as BridgeRequest;
        methods.push(request.method);
        queueMicrotask(() => dispatch(JSON.stringify(responseFor(request))));
      },
    },
  }));

  try {
    const sdk = createClient();
    await sdk.isReady;
    await sdk.actions.ready();

    assert.equal(sdk.isMockMode(), false);
    assert.deepEqual(methods, ["bridge.hello", "actions.ready"]);
  } finally {
    harness.restore();
  }
});
