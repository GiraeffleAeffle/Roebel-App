import assert from "node:assert/strict";
import test from "node:test";
import {
  isMarienfelderPublicDemo,
  normalizeMiniAppBasePath,
  resolvePublicDemoMode,
  withMiniAppBasePath,
} from "./publicDemoMode";

test("only the explicit Marienfelder value enables public demo mode", () => {
  assert.equal(resolvePublicDemoMode("marienfelder"), "marienfelder");
  assert.equal(isMarienfelderPublicDemo(" marienfelder "), true);
  assert.equal(isMarienfelderPublicDemo("walkthrough"), false);
  assert.equal(isMarienfelderPublicDemo(""), false);
  assert.equal(isMarienfelderPublicDemo(undefined), false);
});

test("normalizes only safe optional mini-app base paths", () => {
  assert.equal(normalizeMiniAppBasePath(undefined), undefined);
  assert.equal(normalizeMiniAppBasePath("/"), undefined);
  assert.equal(normalizeMiniAppBasePath("/roebel-data-demo/"), "/roebel-data-demo");
  assert.equal(normalizeMiniAppBasePath("roebel-data-demo"), undefined);
  assert.equal(normalizeMiniAppBasePath("//other.example"), undefined);
  assert.equal(normalizeMiniAppBasePath("/demo?x=1"), undefined);
});

test("prefixes public assets only when a base path is configured", () => {
  assert.equal(withMiniAppBasePath("/assets/Logo-data.png", "/demo"), "/demo/assets/Logo-data.png");
  assert.equal(withMiniAppBasePath("assets/Logo-data.png", undefined), "/assets/Logo-data.png");
});
