/**
 * Small, reviewable Röbel corpus for Public Mecky.
 *
 * These are corrected projections of two public pages, not live scrapes. A
 * source change is admitted only through a new reviewed diff with new digests.
 * The consumer independently checks the canonical envelope hash before use.
 */

const GENERATED_AT = "2026-08-31T00:25:00.000Z";

export const ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE = Object.freeze({
  local_news: Object.freeze({
    schemaVersion: "reviewed_public_knowledge_projection_v1",
    municipalityId: "roebel-mueritz",
    sourceKind: "local_news",
    generatedAt: GENERATED_AT,
    records: Object.freeze([
      Object.freeze({
        evidenceId:
          "sha256:d4fe2a94057c7803a8d96e9443392b3ad758334a4660aa9d7cd2f0df6bf8cd37",
        municipalityId: "roebel-mueritz",
        sourceKind: "local_news",
        authority: "editorial_report",
        title:
          "Stadtvertreter in Röbel starten ins neue Jahr – Haushalt beschlossen, Investitionen geplant",
        summary:
          "Müritz Tipp berichtet über die erste Stadtvertretungssitzung 2026: Der Haushalt 2026 wurde beschlossen; außerdem werden Investitionen, eine Ausfallbürgschaft, Spenden und Gremienneubesetzungen genannt.",
        publishedAt: "2026-03-07T00:00:00.000Z",
        admissionState: "admitted",
        lifecycle: "current",
        publisher: "Müritz Tipp",
        articleUrl:
          "https://ol.wittich.de/titel/3520/ausgabe/4/2026/artikel/00000000000052270197-OL-3520-2026-10-4-0",
        reviewedAt: GENERATED_AT,
      }),
    ]),
    contentSha256:
      "sha256:5aac6e2807a6631bb5333ad536fd29322c3c5b630e1bdbaffba87665054af26e",
  }),
  ratsinformation: Object.freeze({
    schemaVersion: "reviewed_public_knowledge_projection_v1",
    municipalityId: "roebel-mueritz",
    sourceKind: "ratsinformation",
    generatedAt: GENERATED_AT,
    records: Object.freeze([
      Object.freeze({
        evidenceId:
          "sha256:a19c4665c19ca36dc67906744c09273865aeecf51239380083a35d65f0d6f236",
        municipalityId: "roebel-mueritz",
        sourceKind: "ratsinformation",
        authority: "official_record",
        title:
          "Beschlussvorlage BV-25-2026-007: Haushalt 2026 der Stadt Röbel/Müritz",
        summary:
          "Die öffentliche ALLRIS-Vorlage dokumentiert die Entscheidung der Stadtvertretung vom 24. Februar 2026: Der Haushalt 2026 wurde unverändert beschlossen.",
        publishedAt: "2026-02-24T00:00:00.000Z",
        admissionState: "admitted",
        lifecycle: "current",
        body:
          "Öffentliche Beschlussvorlage des Amts für Finanzen; Entscheidung der Stadtvertretung Röbel/Müritz am 24.02.2026: unverändert beschlossen.",
        recordId: "BV-25-2026-007",
        recordUrl:
          "https://roebelmueritz.sitzung-mv.de/public/vo020?TOLFDNR=1014873&VOLFDNR=1002054&refresh=false",
        reviewedAt: GENERATED_AT,
      }),
    ]),
    contentSha256:
      "sha256:3c92888db5544104ca781492a675f9a807970d0be813a366434c88a46ed0d358",
  }),
} as const);

export type RoebelReviewedSourceKind = keyof typeof ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE;

export function roebelReviewedPublicKnowledge(
  municipalityId: string,
  sourceSegment: string
) {
  if (municipalityId !== "roebel-mueritz") return null;
  if (sourceSegment === "local-news") {
    return ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE.local_news;
  }
  if (sourceSegment === "ratsinformation") {
    return ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE.ratsinformation;
  }
  return null;
}
