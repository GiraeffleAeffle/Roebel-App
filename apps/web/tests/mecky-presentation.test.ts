import assert from "node:assert/strict";
import test from "node:test";
import { meckyPresentation, meckySourceHref } from "../src/lib/mecky-presentation";

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

test("department citations open Fachantworten without rewriting their signed source", () => {
  const url = `https://app.example/app/diskussion/${"a".repeat(64)}`;
  const title = "Testantwort Verkehr · Querung";
  const signed = `Antwort\n\nQuellenbelege: ${title} – ${url}`;
  const source = meckyPresentation(signed, [url]).sources[0]!;
  assert.equal(meckySourceHref(source.url, source.title), `${url}#citizen-brief`);
  assert.equal(source.url, url);
  for (const [destination, label] of [[url, "Ausgangsdiskussion"], [url, "Testantwort Unbekannt · Querung"],
    [url + "?token=x", title], [url + "#discussion-arguments", title], [url.replace("https:", "http:"), title],
    ["https://app.example/other", title]]) {
    assert.equal(meckySourceHref(destination!, label!), destination);
  }
});
