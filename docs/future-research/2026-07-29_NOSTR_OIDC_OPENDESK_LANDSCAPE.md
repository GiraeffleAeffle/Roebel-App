# Nostr-Ökosystem, OIDC-Tooling & openDesk — Einordnung 2026-07-29

> **Recherche vom 2026-07-29** (zwei parallele Recherchepässe gegen den Live-Stand des
> Repos, verifiziert gegen [STATE_OF_NOSTR](../STATE_OF_NOSTR.md),
> [SOVEREIGN_ARBEITSBEREICH_STATE](../SOVEREIGN_ARBEITSBEREICH_STATE.md),
> [WORKSPACE_SSO_SETUP](../WORKSPACE_SSO_SETUP.md)). Schwesterdokument der
> Regulierungs-Recherche
> [2026-07-29_ITPLR_BLOCKCHAIN_REGULATORY_LANDSCAPE](2026-07-29_ITPLR_BLOCKCHAIN_REGULATORY_LANDSCAPE.md);
> operative Pflichten in [DSGVO_AI_ACT_COMPLIANCE](../DSGVO_AI_ACT_COMPLIANCE.md).

**Verdict in einem Satz:** Beide Architektur-Wetten — strfry-Relay mit Allow-List +
NIP-77-Föderation und der Röbel-ID-Keystone (panva-OIDC vor Nextcloud/Collabora, Matrix
via MAS später) — sind 2026 extern validiert; openDesk **nicht adoptieren, aber
komponentenkompatibel bleiben**.

---

## 1. Nostr-Ökosystem, Stand Juli 2026

### Was unser Design bestätigt

- **NIP-77 (Negentropy) ist kanonisiert** — als NIP gemerged, Implementierungen jenseits
  strfry (Citrine 3.0, NDK-Sync). Unser NSP-9-Föderationsmuster ist Protokollstandard,
  nicht strfry-proprietär.
- **„Relay mit Write-Policy = die Community"** ist exakt das Flotilla-Modell (Coracle;
  aktiv entwickelt, letzter Commit 2026-07-27, trotz archiviertem GitHub-Mirror).
- **Wallet-abgeleitete Client-Keys** umgehen das ungelöste Key-Management-Problem des
  Ökosystems (Bunker/Signer-Landschaft: Amber 6.2.1, Clave 1.0, Keycast — hodlbod:
  „Key Management is a Blocker").
- **Agent-Labeling** (`bot: true` + `netizen_agent`-Tag) ist zugleich die halbe
  AI-Act-Art.-50-Erfüllung für Nostr-Inhalte.
- **Keine bekannte Kommune betreibt einen eigenen Relay** (gezielte Suche, Stand 07/2026)
  — Röbel wäre nach Aktenlage eine Premiere. Erzählbar in Förderanträgen/Presse.

### Jetzt übernehmen (billig)

| # | Was | Warum |
|---|---|---|
| 1 | **strfry 1.1.0 → 1.1.1** (2026-07-21) | Sync-Transaktions-Split, Slow-Client-Capping, Stabilitätsfixes |
| 2 | **NIP-42 + NIP-70** auf dem Members-Relay | strfry unterstützt beides nativ — gated reads sind Konfigurationsarbeit, kein Binary-Wechsel (Korrektur zur bisherigen §1-Formulierung im State-Doc; NIP-29 fehlt strfry dagegen wirklich) |
| 3 | **NIP-65-Relay-Lists (kind 10002) + NIP-05 `name@roebel.app`** | Outbox-Routing ist 2026 Mehrheits-Realität — ohne Relay-List sind Röbel-Inhalte für externe Clients praktisch unsichtbar |
| 4 | **NIP-52** für Stadt-Veranstaltungsdaten | Standard-Kalender-Kinds statt proprietärer Kinds (betrifft [PUBLIC_DATA_ON_NOSTR](../PUBLIC_DATA_ON_NOSTR.md)) |
| 5 | **Blossom statt NIP-96** für jedes Nostr-seitige Medien-Hosting | NIP-96 offiziell „unrecommended: replaced by Blossom"; NIP-B7 verankert |
| 6 | **NIP-09/NIP-62 → echte LMDB-Löschung** (auch Mirror) + DSA-Meldeweg | größtes Compliance-Delta; jetzt Pflichtenheft in [DSGVO_AI_ACT_COMPLIANCE §2.1 Nr. 4](../DSGVO_AI_ACT_COMPLIANCE.md) — NIP-62 („Request to Vanish", draft) ist ausdrücklich für rechtsverbindliche Löschpflichten geschrieben, strfry braucht dafür Plugin/Cron |

### Beobachten (6–12 Monate)

- **NIP-29-Governance-Cluster**: 5 offene Proposals (Invite-Codes, Pinning, Melde-Flows,
  RBAC; Juni 2026). Wenn gemerged, wird NIP-29 zur ernsthaften Ergänzung des
  Relay-=-Community-Modells; Implementierungspfad wäre khatru/relay29 **neben** strfry.
- **Marmot / White Noise** (MLS über Nostr): Spec seit 2026 „Adopted", zwei
  Least-Authority-Audits (publiziert 2026-04-07). Der richtige Kandidat für den
  Nostr-Messaging-R&D-Slot aus der
  [Chat-Protokoll-Entscheidung](2026-07-26_CHAT_PROTOCOL_DECISION.md) — noch nicht
  bürgertauglich.
- **Keycast** (Team-Signing mit Policies, Audit Mai 2026): Alternativmodell für
  Org-npubs. Unser Roster-Modell (Org-Identität via Autoritätsliste, `3985a1f6`) bleibt
  erste Wahl; Keycast prüfen, falls Orgs außerhalb der App signieren wollen.
- **NIP-98 / W3C-Schnorr-HTTP-Auth** als Login-Methode an Röbel ID: Es gibt **keine
  fertige OIDC↔Nostr-Brücke** (Nostr-OIDC ist Konzept ohne Implementierung) — selbst
  verdrahten ist Stand der Technik, falls je gewünscht.

### Nüchternheit

Netzweit ~**17k täglich aktive Nutzer, stagnierend** (stats.nostr.band; Analysen Ende
2025: Flatline). Konsequenz: Nostr ist für Röbel **Infrastruktur-Layer** (Souveränität,
Föderation, Portabilität), kein Reichweitenkanal. Reichweite käme über Ditto/Mostr-
Spiegelung ins Fediverse/Bluesky. Entwickler-/Funding-Seite ist dagegen robust
(OpenSats 17. Nostr-Welle 2026-05-20; wöchentliche Releases).

### Rechtsrahmen für den Relay-Betrieb

Keine Präzedenzfälle zu Nostr-Relays. Beste analoge Quelle: **Bundestag WD 7-026/26
(2026-05-29)** zu dezentralen Netzwerken — Relay-Betreiber = DSA-**Hostingdienst**
(Art.-16-Meldeweg, Begründungspflicht bei Entfernungen, Haftungsprivileg Art. 6;
Plattformpflichten Art. 20 ff. entfallen für Kleinstunternehmen) und sehr wahrscheinlich
DSGVO-**Verantwortlicher** für den eigenen Relay + Mirror. Die Allow-List senkt das
DSA-Risiko drastisch (kaum fremde illegale Inhalte möglich). Details + Pflichten:
[DSGVO_AI_ACT_COMPLIANCE](../DSGVO_AI_ACT_COMPLIANCE.md).

---

## 2. openDesk & OIDC-Tooling, Stand Juli 2026

### openDesk: nicht adoptieren, kompatibel bleiben

openDesk **v1.17.0 (2026-07-22)**: Nubus-IAM (OpenLDAP + Keycloak), OX App Suite 8.49,
**Nextcloud 32.0.9**, **Collabora 25.04.x**, Element/Synapse (klassisches OIDC gegen
Keycloak, **kein MAS**), Jitsi, OpenProject 17.6, XWiki, CryptPad. Deployment:
Kubernetes-only, 35+ Helm-Charts; Single-Node nur als K3s-Evaluations-Setup. Produktion:
RKI (~7.000), Bundeswehr-Rahmenvertrag, **Internationaler Strafgerichtshof** (seit
10/2025), CKKI-Notfallarbeitsplatz-Pilot (DRV/BA, positive Bilanz 2026-07-21). ZenDiS:
Neuaufstellung seit 2026-04-15, Vertrieb über Distributoren; **Länder weiterhin nicht
Gesellschafter**.

**Warum nicht als Suite:** IAM ist nicht austauschbar — alle Apps sind RPs gegen
*openDesks* Keycloak, Gruppen fließen per **LDAP-Polling**, nicht per OIDC-Claims. Ein
externer IdP (Röbel ID) kann nur Upstream-Broker hinter Keycloak sein, und beim
Ad-hoc-Provisioning gilt wörtlich: „group memberships are not transferred/updated" —
unser `org:<id>:<role>`-Claim-Modell müsste parallel per UDM-REST-API gepflegt werden.
Doppelte Gruppenwahrheit = genau das Anti-Pattern, das der Keystone vermeidet. Deckt sich
mit der bestehenden Positionierung ([Stadtstack-Alignment](../STADTSTACK_ALIGNMENT.md)):
openDesk dient Institutionen, Röbel dient Bürgern mit Wallet-Identität.

**Was wir stattdessen nutzen:** openDesk als **Komponenten-Menü und Referenz-Hardening**.
Wir fahren dieselben Kernkomponenten (Nextcloud 32 + Collabora 25.04) — openDesks
Open-CoDE-Repo liefert Versionspins/Configs gratis. Später gewünschtes Wiki/Projekte:
XWiki/OpenProject einzeln als direkte OIDC-RPs gegen Röbel ID (gleiche
Integrationsklasse wie Nextcloud; Gruppen-Sync dann selbst lösen).

### Die validierten Bausteine im Einzelnen

- **`user_oidc` 8.10.1** (NC 29–34, von Nextcloud gepflegt, jetzt im Admin-Manual):
  User-Provisioning beim Erstlogin + **Gruppen-Provisioning aus dem `groups`-Claim** —
  exakt das [WORKSPACE_SSO_SETUP](../WORKSPACE_SSO_SETUP.md)-Design. SCIM bleibt
  Community-Ware; Claims + eigene Sync-Skripte sind 2026 der pragmatische Weg.
- **Team Folders** (umbenannt von Group Folders) aktiv gepflegt; bekannter
  Mount-Stolperstein beim NC-32→33-Upgrade → konservativ bleiben (openDesk shippt auch
  noch NC 32). Hub 26 Winter = NC 33 (GA 2026-02-25).
- **Collabora**: Best Practice unverändert — eingebauter CODE nur für Evaluierung,
  **Produktion = separater Collabora-Container**. Collabora 26.04 erschienen; openDesk
  noch auf 25.04.
- **Matrix/MAS**: MSC3861-Spec fertig, matrix.org läuft seit 2025-04-07 auf MAS. MAS
  akzeptiert **beliebige Upstream-OIDC-Provider first-class** (Authorization-Code +
  Discovery genügen; Claim-Mapping per Jinja2-Template) → **Röbel ID → MAS ist ein
  dokumentierter Standardpfad**. Für unsere Größe: **ESS Community** (AGPLv3, Synapse +
  MAS + Element Web/Call, ausgelegt auf 1–100 Nutzer auf einer Maschine, Chart 26.7.0)
  oder matrix-docker-ansible-deploy ohne K8s. Synapse-Bestandsserver: MAS ist Opt-in,
  Einweg-Migration (syn2mas).
- **panva `node-oidc-provider` kerngesund**: v9.9.0/9.10.0/**9.11.1** allein im Juli
  2026, OpenID Certified, keine Advisories, 8.x-EOL sauber terminiert. Kein
  Wechselgrund; Alternativen (Hydra, ZITADEL, authentik, Keycloak) nur als Notfallliste.

### EUDI-Konvergenz — der 2027-Ausbau

**panva 9.10.0 bringt OpenID4VCI-Support** — unsere OIDC-Bibliothek wächst selbst
Richtung EUDI-Stack. Specs final (OpenID4VP 1.0 2025-07-09, OpenID4VCI 1.0 2025-09-16,
HAIP 1.0 2025-12-24; OIDF-Interop 98 %). TypeScript-Verifier-Bausteine aus dem deutschen
Funke-Kontext liegen bei der OpenWallet Foundation (openid4vc-ts, dcql-ts). Pfad:
**Röbel ID als OpenID4VP-Verifier** — Presentation-Request an die EUDI-Wallet →
SD-JWT-VC/mdoc-Verifikation → geprüfter Wohnsitz-Claim ins ID-Token. Das ist die
technische Einlösung des `attestationSource`-Pfads aus der
[Regulierungs-Recherche](2026-07-29_ITPLR_BLOCKCHAIN_REGULATORY_LANDSCAPE.md#4-eudi-wallet-wichtigster-strategischer-anschlusspunkt-2026-2028).
Ehrlich: Die RP-Seite ist „baubar, nicht npm-install-fertig"; rechtlich anerkannte
Abfragen brauchen später eine Relying-Party-Registrierung (BNetzA-Aufsicht).

---

## 3. Konsequenzen (priorisiert)

1. **Relay-Compliance-Paket** (strfry 1.1.1, NIP-09/62-Löschworkflow inkl. Mirror,
   Meldeweg) — Pflichtteil, siehe Compliance-Doc Priorität 7.
2. **Sichtbarkeitspaket** (NIP-65 + NIP-05 + NIP-52 + ggf. Blossom) — macht die
   Stadt-Publikationen im Ökosystem real auffindbar.
3. **Arbeitsbereich unverändert**: erst
   [SECURITY_FINDINGS_2026-07-28](../SECURITY_FINDINGS_2026-07-28.md) §1 fixen, dann
   Flag; an der Architektur ändert die Recherche nichts.
4. **Matrix, wenn dran**: ESS Community bzw. ansible-deploy mit Röbel ID als
   MAS-Upstream — kein eigenes Auth-Design bauen.
5. **2027**: Röbel-ID-Verifier-Ausbau, sobald die deutsche EUDI-Wallet (Start
   2027-01-02) real Claims liefert.
