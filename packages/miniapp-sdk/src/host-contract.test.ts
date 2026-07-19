import assert from "node:assert/strict";
import test from "node:test";

import { routeExpoMiniAppMessage } from "../../../apps/expo/lib/miniapp-host-transport";
import { createWebMiniAppHost } from "../../../apps/web/src/lib/miniapp-host/index";
import { createHostBridge } from "./host/index";
import { NETIZEN_PROTOCOL, type BridgeMessage } from "./types";

type MessageListener = (event: MessageEvent) => void;

function installFakeWindow() {
  const listeners = new Set<MessageListener>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const fakeWindow = {
    addEventListener(type: string, listener: MessageListener) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type: string, listener: MessageListener) {
      if (type === "message") listeners.delete(listener);
    },
    open() {},
    confirm() {
      return false;
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
  return {
    dispatch(event: Partial<MessageEvent>) {
      for (const listener of listeners) listener(event as MessageEvent);
    },
    restore() {
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    },
  };
}

function afterDispatch() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

test("the web host accepts bridge messages only from its iframe and configured origin", async () => {
  const windowHarness = installFakeWindow();
  const replies: Array<{ message: BridgeMessage; targetOrigin: string }> = [];
  const contentWindow = {
    postMessage(message: BridgeMessage, targetOrigin: string) {
      replies.push({ message, targetOrigin });
    },
  };
  const iframe = { contentWindow } as unknown as HTMLIFrameElement;
  const host = createWebMiniAppHost({
    iframe,
    app: {
      id: "roebel-data",
      slug: "roebel-data",
      name: "Röbel Data",
      homeUrl: "https://mini.roebel.app/roebel-data",
      permissions: [],
      enforcePermissions: true,
    },
    user: null,
  });
  const request = {
    netizen: NETIZEN_PROTOCOL,
    id: "ready-1",
    method: "actions.ready",
  } as const;

  try {
    windowHarness.dispatch({
      source: {} as Window,
      origin: "https://mini.roebel.app",
      data: request,
    });
    windowHarness.dispatch({
      source: contentWindow as unknown as Window,
      origin: "https://attacker.example",
      data: request,
    });
    await afterDispatch();
    assert.equal(replies.length, 0);

    windowHarness.dispatch({
      source: contentWindow as unknown as Window,
      origin: "https://mini.roebel.app",
      data: request,
    });
    await afterDispatch();

    assert.equal(replies.length, 1);
    assert.equal(replies[0].targetOrigin, "https://mini.roebel.app");
    assert.deepEqual(replies[0].message, {
      netizen: NETIZEN_PROTOCOL,
      id: "ready-1",
      result: undefined,
    });
  } finally {
    host.destroy();
    windowHarness.restore();
  }
});

test("the Expo host delivers only messages from the active mini-app origin", async () => {
  const replies: BridgeMessage[] = [];
  const bridge = createHostBridge({
    post: (message) => replies.push(message),
    handlers: { ready: () => undefined },
    grantedPermissions: [],
  });
  const request = JSON.stringify({
    netizen: NETIZEN_PROTOCOL,
    id: "ready-expo-1",
    method: "actions.ready",
  });

  const rejected = routeExpoMiniAppMessage({
    activeSourceUrl: "https://mini.roebel.app/roebel-data",
    messageUrl: "https://attacker.example/injected",
    data: request,
    deliver: (raw) => bridge.handleMessage(raw),
  });
  await afterDispatch();
  assert.equal(rejected, false);
  assert.equal(replies.length, 0);

  const delivered = routeExpoMiniAppMessage({
    activeSourceUrl: "https://mini.roebel.app/roebel-data",
    messageUrl: "https://mini.roebel.app/roebel-data?embedded=1",
    data: request,
    deliver: (raw) => bridge.handleMessage(raw),
  });
  await afterDispatch();

  assert.equal(delivered, true);
  assert.deepEqual(replies, [
    {
      netizen: NETIZEN_PROTOCOL,
      id: "ready-expo-1",
      result: undefined,
    },
  ]);
});
