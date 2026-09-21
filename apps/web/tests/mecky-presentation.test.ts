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

test("the staging banner replaces only the verified legacy answer envelope", () => {
  const url = `https://app.example/app/diskussion/${"b".repeat(64)}`;
  const answer = "KI-Zusammenfassung: Im Kostenmodell kostet A 16.600 Euro. Eine Finanzierung ist offen.";
  const content = `Synthetischer Testkontext · keine amtliche Stellungnahme.\n\n${answer}\n\nQuellenbelege: Testantwort Finanzen · Begegnungsort – ${url}`;
  assert.deepEqual(meckyPresentation(content, [url]), { body: answer, sources: [{ url, title: "Fachantwort Finanzen · Begegnungsort" }] });
  assert.equal(meckyPresentation(content, ["https://wrong.example"]).body, content);
  assert.ok(content.startsWith("Synthetischer Testkontext"));
});

test("department citations open Fachantworten without rewriting their signed source", () => {
  const url = `https://app.example/app/diskussion/${"a".repeat(64)}`;
  const title = "Testantwort Verkehr · Querung";
  const signed = `Antwort\n\nQuellenbelege: ${title} – ${url}`;
  const source = meckyPresentation(signed, [url]).sources[0]!;
  assert.equal(source.title, "Fachantwort Verkehr · Querung");
  assert.equal(meckySourceHref(source.url, source.title), `${url}#citizen-brief`);
  assert.equal(source.url, url);
  for (const [destination, label] of [[url, "Ausgangsdiskussion"], [url, "Testantwort Unbekannt · Querung"],
    [url + "?token=x", title], [url + "#discussion-arguments", title], [url.replace("https:", "http:"), title],
    ["https://app.example/other", title]]) {
    assert.equal(meckySourceHref(destination!, label!), destination);
  }
});

test("numbered claim citations retain their markers and open the cited Fachantworten", () => {
  const url = `https://app.example/app/diskussion/${"c".repeat(64)}`;
  const content = `Kostenmodell A. [1]\nNutzungsmodell B. [2]\n\nQuellenbelege: [1] Testantwort Finanzen · Begegnungsort – ${url}; [2] Fachantwort Stadtplanung · Begegnungsort – ${url}`;
  const presentation = meckyPresentation(content, [url, url]);
  assert.equal(presentation.body, "Kostenmodell A. [1]\nNutzungsmodell B. [2]");
  assert.deepEqual(presentation.sources.map(source => source.title), [
    "[1] Fachantwort Finanzen · Begegnungsort", "[2] Fachantwort Stadtplanung · Begegnungsort",
  ]);
  for (const source of presentation.sources) {
    assert.equal(source.url, url);
    assert.equal(meckySourceHref(source.url, source.title), `${url}#citizen-brief`);
  }
  assert.equal(meckySourceHref(url, "[1] Ausgangsdiskussion"), url);
});
