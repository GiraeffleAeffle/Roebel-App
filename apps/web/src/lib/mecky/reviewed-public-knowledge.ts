/**
 * Small, reviewable Röbel corpus for Public Mecky.
 *
 * These are corrected projections of two public pages, not live scrapes. A
 * source change is admitted only through a new reviewed diff with new digests.
 * The consumer independently checks the canonical envelope hash before use.
 */

const GENERATED_AT = "2026-08-31T18:58:00.000Z";

export const ROEBEL_REVIEWED_PUBLIC_KNOWLEDGE = Object.freeze({
  local_news: Object.freeze({
    schemaVersion: "reviewed_public_knowledge_projection_v1",
    municipalityId: "roebel-mueritz",
    sourceKind: "local_news",
    generatedAt: GENERATED_AT,
    records: Object.freeze([
      Object.freeze({
        evidenceId:
          "sha256:7160c777b757786cbaca10e3bdd34ae75c15f51bc87e5708cbe527e771570178",
        municipalityId: "roebel-mueritz",
        sourceKind: "local_news",
        authority: "editorial_report",
        title: "MV17a Dambeck–Bollewick (geplant: Stuer–Röbel)",
        summary:
          "Die Fachseite dokumentiert als belegten Ausgangspunkt den 4,6 km langen, asphaltierten Radweg Dambeck–Bollewick, eröffnet am 31. Mai 2022, und nennt weitere 15 km bis Röbel als geplant. Das sind prüfbare Anknüpfungspunkte für Bürger und zuständige Stellen; die Quelle belegt keine beschlossene weitere Maßnahme und nennt den Zeitplan als offen.",
        publishedAt: "2022-06-06T00:00:00.000Z",
        admissionState: "admitted",
        lifecycle: "current",
        publisher: "Bahntrassenradeln — Achim Bartoschek",
        articleUrl: "https://www.bahntrassenradeln.de/details/mv17a.htm",
        reviewedAt: GENERATED_AT,
      }),
    ]),
    contentSha256:
      "sha256:d7dcc103886e9f4e7c4cd5636b8e26bbc5d9d81b417b09e65f60b279973f14be",
  }),
  ratsinformation: Object.freeze({
    schemaVersion: "reviewed_public_knowledge_projection_v1",
    municipalityId: "roebel-mueritz",
    sourceKind: "ratsinformation",
    generatedAt: GENERATED_AT,
    records: Object.freeze([
      Object.freeze({
        evidenceId:
          "sha256:648c2c27fb9508f440de2fcc67978b0f5b68972835ad4b90582016afb84ed097",
        municipalityId: "roebel-mueritz",
        sourceKind: "ratsinformation",
        authority: "official_record",
        title:
          "Einwohnerfragestunde: Verkehrssicherheit B 198 am Abzweig Bollewick/Erlenkamp",
        summary:
          "Das genehmigte öffentliche Wortprotokoll dokumentiert ein Bürgeranliegen zur Verkehrssicherheit an der B 198 am Abzweig Bollewick/Erlenkamp. Eine 70er-Zone oder ein Überholverbot wurden als Anliegen genannt; Frau Siegmund nahm das Thema zur Weitergabe mit. Es dokumentiert, was zuständige Stellen prüfen könnten; es ist kein Beschluss über eine Maßnahme.",
        publishedAt: "2025-12-17T00:00:00.000Z",
        admissionState: "admitted",
        lifecycle: "current",
        body:
          "Öffentliche Einwohnerfragestunde, TOP Ö 7, Sitzung des Amtsausschusses Röbel-Müritz am 17.12.2025. Das Protokoll gibt ein Einwohneranliegen wieder und hält fest, dass Frau Siegmund das Thema mitnimmt und weitergibt; es enthält keinen Maßnahmenbeschluss.",
        recordId: "Amtsausschuss-2025-12-17-Oe7",
        recordUrl:
          "https://roebelmueritz.sitzung-mv.de/public/to020?SILFDNR=1000579&TOLFDNR=1014284",
        reviewedAt: GENERATED_AT,
      }),
    ]),
    contentSha256:
      "sha256:577bd781debe3d3465cfd34ad0127612bdc1827d6eae15fe3d7446fd32ac9089",
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
