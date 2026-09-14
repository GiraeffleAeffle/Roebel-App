import assert from "node:assert/strict";
import test from "node:test";
import { meckyPresentation } from "../src/lib/mecky-presentation";

test("chat and feed show a compact source list without duplicating the signed footer", () => {
  const urls = ["https://app.example/brief", "https://app.example/brief"];
  const content = "Synthetischer Testkontext.\n\nKI-Zusammenfassung: Zwei Optionen.\n\nQuellenbelege: Verkehr – https://app.example/brief; Finanzen – https://app.example/brief";
  assert.deepEqual(meckyPresentation(content, urls), { body: "Synthetischer Testkontext.\n\nKI-Zusammenfassung: Zwei Optionen.", sources: [
    { title: "Verkehr", url: urls[0] }, { title: "Finanzen", url: urls[1] },
  ] });
  assert.equal(meckyPresentation(content, ["https://wrong.example"]).body, content);
  assert.equal(meckyPresentation(content, []).body, content);
});

test("ordinary answer text and unrecognized footers remain intact", () => {
  for (const content of ["Quellenbelege sind noch zu prüfen.", "Antwort\n\nQuellenbelege: Verkehr – https://app.example/brief\nOffene Rückfrage."]) {
    assert.equal(meckyPresentation(content, ["https://app.example/brief"]).body, content);
  }
});
