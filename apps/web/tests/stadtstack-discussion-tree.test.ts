import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildArgumentTree,
  buildSunburstSegments,
  summarizeArgumentTree,
  type StagingArgument,
} from "../src/lib/stadtstack/discussion-tree";

const argumentsFixture: StagingArgument[] = [
  {
    id: "root",
    parentId: null,
    rootId: "root",
    stance: "root",
    author: { name: "Anna (synthetisch)", kind: "citizen" },
    content: "Soll die Querung der Marienfelder Straße sicherer werden?",
    createdAt: "2026-08-13T08:00:00.000Z",
  },
  {
    id: "pro-a",
    parentId: "root",
    rootId: "root",
    stance: "pro",
    author: { name: "Omar (synthetisch)", kind: "citizen" },
    content: "Eine klar markierte Querung verbessert die Sichtbarkeit.",
    createdAt: "2026-08-13T08:01:00.000Z",
  },
  {
    id: "con-a",
    parentId: "root",
    rootId: "root",
    stance: "con",
    author: { name: "Anna (synthetisch)", kind: "citizen" },
    content: "Eine einzelne Maßnahme könnte falsche Sicherheit erzeugen.",
    createdAt: "2026-08-13T08:02:00.000Z",
  },
  {
    id: "pro-b",
    parentId: "con-a",
    rootId: "root",
    stance: "pro",
    author: { name: "Omar (synthetisch)", kind: "citizen" },
    content: "Darum sollten mehrere Varianten gemeinsam geprüft werden.",
    createdAt: "2026-08-13T08:03:00.000Z",
  },
];

test("builds one deterministic pro/con tree from the signed Nostr graph", () => {
  const tree = buildArgumentTree(argumentsFixture);
  assert.equal(tree.root.argument.id, "root");
  assert.deepEqual(tree.root.children.map((node) => node.argument.id), ["pro-a", "con-a"]);
  assert.equal(tree.root.children[1]?.children[0]?.argument.id, "pro-b");
  assert.deepEqual(tree.orphans, []);
});

test("maps the same tree to non-overlapping sunburst arcs without inventing claims", () => {
  const tree = buildArgumentTree(argumentsFixture);
  const segments = buildSunburstSegments(tree.root);
  assert.deepEqual(new Set(segments.map((segment) => segment.id)), new Set(["pro-a", "con-a", "pro-b"]));
  for (const segment of segments) {
    assert.equal(segment.startAngle < segment.endAngle, true);
    assert.equal(segment.innerRadius < segment.outerRadius, true);
    assert.equal(["pro", "con"].includes(segment.stance), true);
  }
  const firstLevel = segments.filter((segment) => segment.depth === 1);
  assert.equal(firstLevel[0]?.startAngle, 0);
  assert.equal(firstLevel.at(-1)?.endAngle, Math.PI * 2);
});

test("summarises connected branches as structure rather than support", () => {
  const tree = buildArgumentTree(argumentsFixture);
  assert.deepEqual(summarizeArgumentTree(tree.root), {
    argumentCount: 3,
    proArgumentCount: 2,
    conArgumentCount: 1,
    maxDepth: 2,
  });
});

test("fails closed on duplicate ids and keeps cycles outside the rendered tree", () => {
  assert.throws(
    () => buildArgumentTree([...argumentsFixture, { ...argumentsFixture[1]! }]),
    /argument_id_duplicate/,
  );

  const cycle: StagingArgument[] = [
    argumentsFixture[0]!,
    { ...argumentsFixture[1]!, id: "cycle-a", parentId: "cycle-b" },
    { ...argumentsFixture[2]!, id: "cycle-b", parentId: "cycle-a" },
  ];
  const tree = buildArgumentTree(cycle);
  assert.deepEqual(tree.root.children, []);
  assert.deepEqual(tree.orphans.map((entry) => entry.id), ["cycle-a", "cycle-b"]);
  assert.deepEqual(summarizeArgumentTree(tree.root), {
    argumentCount: 0,
    proArgumentCount: 0,
    conArgumentCount: 0,
    maxDepth: 0,
  });
});
