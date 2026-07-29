# DSGVO- & AI-Act-Compliance — operative Rechtslage der Röbel App

> **Stand 2026-07-29.** Dieses Dokument ist die operative Ergänzung zum
> [Legal Masterplan](future-research/LEGAL_MASTERPLAN.md) (Entity/Treasury/Spendenrecht)
> und zur Recherche [IT-PLR Blockchain → Landschaft 2026](future-research/2026-07-29_ITPLR_BLOCKCHAIN_REGULATORY_LANDSCAPE.md).
> Es beantwortet: Was müssen wir **konkret tun**, damit das bestehende System
> (Citizen/Attester-NFTs auf Gnosis, MACI-Voting, Röbel Münzen, Mecky) rechtlich sauber
> betrieben wird?
>
> ⚠️ **Keine Rechtsberatung.** Vor Außenwirkung (DPIA-Einreichung, Streitfall) von einer
> deutschen Datenschutz-Kanzlei prüfen lassen. Kennzeichnung: **[Gesetz]**, **[Leitlinie]**,
> **[Offen]**, **[TODO]**.

---

## 0. Ausgangslage in einem Absatz

Die finalen **EDPB Guidelines 02/2025 „Blockchain & personenbezogene Daten"**
(angenommen **2026-07-07**, [PDF v2.0](https://www.edpb.europa.eu/system/files/2026-07/edpb_guidelines_202502_blockchain_v2_en.pdf))
stufen Wallet-Adressen natürlicher Personen als personenbezogene Daten ein (§ 26, Fn. 12
auch für On-Chain-Metadaten), raten von personenbezogenen Payloads on-chain ab (auch
verschlüsselt/gehasht, §§ 48–52) und verlangen Löschbarkeit „by design" (§§ 102–104) sowie
eine blockchain-spezifische **DPIA** (§§ 97–99). Trotz massiver Industrie-Kritik wurde die
finale Fassung **nicht** entschärft. **[Leitlinie]** — kein Gesetz, aber der Maßstab, den
der LfDI M-V anlegen würde. Unser Design (keine Namen on-chain, Identitätsbrücke off-chain,
MACI verbirgt Stimminhalte, Verein als Verantwortlicher) ist grundsätzlich die richtige
Architektur; **was fehlt, ist die Papierlage** — genau die liefern Abschnitte 1–3.
Zusätzlich akut: **AI Act Art. 50 gilt ab 2026-08-02** (Abschnitt 4).

---

## 1. DPIA (Datenschutz-Folgenabschätzung) — Arbeitsentwurf

Nach Art. 35 DSGVO + EDPB §§ 97–99 als **laufende** DPIA zu führen (bei jeder neuen
On-Chain-Verarbeitung fortschreiben). Dieser Abschnitt ist der inhaltliche Rohbau. **[TODO:
in ein formales DPIA-Dokument des Vereins überführen, Verantwortlichen benennen, Datum,
Unterschrift.]**

### 1.1 Systematische Beschreibung der Verarbeitung

**On-chain (Gnosis Chain, öffentlich, permissionless):**

| Verarbeitung | Vertrag | Personenbezug |
|---|---|---|
| Citizen-Status (Soulbound-NFT) | CitizenNFTv2 `0x59aA26…` | Wallet ↔ „Einwohner:in von Röbel" — pseudonym, aber durch uns verknüpfbar |
| Attester-Status + Attestierungs-/Revocation-Events | AttesterNFTv2 `0xC587F3…` | wer wen bestätigt/entzogen hat (Event-Logs) |
| MACI-Sign-ups, Poll-Joins, verschlüsselte Votes | MACI `0x6663eD…` | Teilnahme-Metadaten sichtbar; **Stimminhalt durch MACI verborgen** |
| Proposals, Tally-Ergebnisse | Governor `0x5F5e49…` | Proposer-Adresse sichtbar |
| Röbel-Münzen-Transfers (Zahlungsgraph) | Circles-Gruppe `0xAc2C…` | vollständiger sozialer Zahlungsgraph |
| EURe-Spenden in die Gemeinschaftskasse | Safe + EURe V2 | Spender-Adressen |

**Nostr (eigener Relay `wss://relay.roebel.app` + Föderations-Mirror):** kind-0-Profile und
kind-1-Posts opt-in publizierender Citizens (nur ohnehin öffentliche App-Inhalte), signiert
mit dem wallet-abgeleiteten npub. Die Wallet↔npub-Zuordnung (`nostr_identities`) ist
bewusst die RLS-Ausnahme ohne Lesezugriff. Als Relay-Betreiber sind wir für die auf
unserem Relay gespeicherten Events **Verantwortliche** und zugleich DSA-Hostingdienst
(Kleinstunternehmen → Art.-16-Meldeweg genügt, keine Plattformpflichten nach Art. 20 ff.;
vgl. Bundestag WD 7-026/26 vom 2026-05-29). Föderierte Events von Peer-Nodes liegen im
Mirror — auch dafür gilt unsere Löschverantwortung.

**Off-chain (Identitätsbrücke — das ist der löschbare Teil):** Supabase (EU-Projekt
`wwbeqhkslxdxhktqzqti`): Nutzerkonten (Wallet ↔ E-Mail via thirdweb inAppWallet,
Anzeigename, `is_verified_citizen`), Attestierungs-Evidenz (`request_evidence`),
`push_tokens.wallet_address`, Nachrichten (Supabase-Rail; XMTP ist E2E mit Nutzer-Keys),
`muenzen_tips`, `roebel_points_card`, `vote_history` (⚠️ bekannter Klartext-Leak, siehe
ZK-Assessment 2026-07-09 — **[TODO]** vorrangig fixen), Feed-Inhalte, `mecky_outreach_log`.

**Auftragsverarbeiter/Empfänger:** Supabase (Hosting), thirdweb (Wallet-Infrastruktur,
Key-Shards), Vercel/Fly (Compute), Anthropic (Mecky), kie.ai (Bildgenerierung), Resend
(Newsletter), Expo (Push), Cloudflare (Stream). **[TODO: AV-Verträge inventarisieren;
Drittlandtransfers (US-Anbieter) mit SCCs/DPF belegen.]**

### 1.2 Zwecke und Rechtsgrundlagen

| Verarbeitung | Zweck | Rechtsgrundlage (Vorschlag) |
|---|---|---|
| Citizen/Attester-NFT | Sybil-resistente Teilnahmeberechtigung | Art. 6(1)(a) Einwilligung (vor Mint, informiert über Permanenz) |
| MACI-Voting | konsultative Bürgerbeteiligung | Art. 6(1)(a); Stimminhalt: durch MACI ohnehin nicht lesbar |
| Münzen/Punkte | Gemeinschaftswährung, Engagement | Art. 6(1)(b) (Nutzungsverhältnis) |
| Mecky/Content | Information, Assistenz | Art. 6(1)(b)/(f) |

**Wichtig bei Einwilligung:** Widerruf ⇒ Anonymisierungspflicht (EDPB § 71) → der
Löschpfad in Abschnitt 2 ist die Erfüllung.

### 1.3 Notwendigkeit: „Warum überhaupt eine öffentliche Blockchain?" (EDPB §§ 46–49)

Dokumentierte Begründung (Kurzfassung; ausführlich in der
[IT-PLR-Checklisten-Zuordnung](future-research/2026-07-29_ITPLR_BLOCKCHAIN_REGULATORY_LANDSCAPE.md#3-die-checkliste-aus-dem-bericht-auf-röbel-angewandt)):
Manipulationsresistenz der Abstimmungsnachweise **gegenüber dem Betreiber selbst** (der
Verein soll Ergebnisse nicht fälschen können — das erfordert öffentliche Verifizierbarkeit,
die eine private/permissioned Lösung des Betreibers gerade nicht bietet), Datenhoheit ohne
Zentralstelle, Forkability als Governance-Garantie für die Kommune. On-chain liegt
ausschließlich das dafür Nötige: pseudonyme Adresse + Status/Commitments — **keine Namen,
keine Klartext-Daten, keine Hashes personenbezogener Payloads**.

### 1.4 Risiken

1. **Verkettung/Profiling** (hoch): eine Smart-Account-Adresse trägt Identitäts-NFT +
   Zahlungsgraph + Governance-Metadaten + XMTP-Identität → Abschnitt 3.
2. **Art.-9-Nähe** (mittel): Teilnahme-Metadaten an politischen Abstimmungen können
   politische Meinung indizieren (Stimminhalt ist durch MACI geschützt).
3. **Permanenz** (mittel): On-Chain-Historie unlöschbar → Mitigation = löschbare
   Off-Chain-Brücke (Abschnitt 2) + Aufklärung vor Mint.
4. **Kleinstadt-Restrisiko** (nicht technisch mitigierbar): Attester wissen sozial, wen
   sie attestiert haben — dokumentieren als verbleibendes Risiko.
5. **Drittland-Nodes** (niedrig-mittel): Gnosis-Validatoren weltweit; EDPB-Kapitel-V-Frage
   **[Offen]** — Argumentation über EuGH C-413/23 P (SRB, 2025-09-04): für Node-Betreiber
   ohne Zugriffsmittel auf unsere Off-Chain-Brücke sind die Daten faktisch anonym.
6. **Quantenhorizont** (niedrig, langfristig): EDPB § 51; betrifft primär verschlüsselte
   Payloads — wir haben keine on-chain.

### 1.5 Abhilfemaßnahmen

**Bestehend:** keine PII on-chain; MACI (Stimmgeheimnis); Off-Chain-Identitätsbrücke
löschbar; UI-Regel „niemals Wallet-Adressen anzeigen, immer Anzeigenamen"; Verein als
klarer Verantwortlicher (EDPB § 44 empfiehlt genau diese Konsortial-/Rechtsträgerlösung);
Shamir 3-of-5 für den Koordinator-Key. **Geplant:** Löschprozess (Abschnitt 2),
Verkettungs-Mitigation (Abschnitt 3), `vote_history`-Fix, AV-Vertrags-Inventar.

---

## 2. Lösch-/Anonymisierungspfad (Art. 17 DSGVO × EDPB § 103)

**Prinzip:** On-chain steht nur die pseudonyme Adresse + Status. Die **einzige Brücke**
Adresse ↔ Person liegt off-chain bei uns. EDPB § 103: Werden alle indirekt
identifizierenden Off-Chain-Daten gelöscht und erlaubt On-Chain nichts Direktidentifizierendes,
gilt die On-Chain-Spur als **effektiv anonymisiert** — das ist unsere Erfüllung von Art. 17.

### 2.1 Löschverfahren bei Betroffenenantrag (Reihenfolge)

1. **Identität des Antragstellers prüfen** (Kontrolle über Wallet oder App-Konto).
2. **On-chain-Status beenden:** Citizen-/Attester-NFT revozieren (bestehender
   Revocation-Flow) — beendet die *aktive* Zuordnung; die Event-Historie bleibt (bewusst,
   siehe 2.3).
3. **Supabase-Brücke löschen:** Nutzerkonto (E-Mail, Anzeigename), `request_evidence`-Zeilen
   des Betroffenen, `push_tokens`, Nachrichten der Supabase-Rail, `vote_history`-Zeilen,
   Feed-Beiträge/Kommentare (bzw. anonymisieren auf „Gelöschtes Mitglied"), `muenzen_tips`-
   und `roebel_points_card`-Zuordnung, Newsletter-Abo (Resend), Einträge in
   `mecky_outreach_log`, XMTP-Konversations-Registry-Zeilen.
4. **Nostr wirklich löschen:** Die App publiziert bereits eine NIP-09-Löschanfrage
   (advisory für fremde Relays). Auf **unserem eigenen** Relay ist Löschung aber
   durchsetzbar und damit geschuldet: Events des npub aus der LMDB des Authoring-Relays
   **und des Föderations-Mirrors** löschen (`strfry delete`/Policy-Workflow), Eintrag in
   `nostr_identities` entfernen (Allow-List-Sync entzieht Schreibrecht im nächsten Pass).
   **[TODO]** NIP-62 („Request to Vanish") serverseitig unterstützen — die Spec ist
   ausdrücklich für rechtsverbindliche Löschpflichten geschrieben; strfry hat dafür keinen
   nativen Support, also per Plugin/Cron abbilden. Gegenüber dem Betroffenen transparent
   machen: Kopien auf fremden Relays/Peer-Nodes liegen außerhalb unserer Kontrolle
   (dokumentiert bereits die UI, vgl. [STATE_OF_NOSTR §4](STATE_OF_NOSTR.md)).
5. **Dritte anstoßen:** thirdweb-Konto-Löschung (E-Mail↔Wallet-Mapping beim Prozessor!),
   Circles-Profil (Name/Avatar im Circles-Profildienst), ggf. Cloudflare-Stream-Videos.
6. **Backups:** Löschung greift in Backup-Rotation binnen Frist X **[TODO: Frist aus
   Supabase-Backup-Policy ermitteln und hier eintragen]**.
7. **Protokollieren** (Nachweispflicht Art. 5(2)) und dem Betroffenen bestätigen, inkl.
   Erläuterung, was on-chain verbleibt und warum das anonymisiert ist.

**[TODO]** Diesen Ablauf als Runbook + idealerweise als Admin-Funktion („Konto löschen")
implementieren und **einmal testweise durchspielen** — ein ungetesteter Löschpfad ist
keiner.

### 2.2 Transparenz VOR dem Mint (Art. 13/14)

**[TODO]** Onboarding-Schritt vor der Citizen-Attestierung ergänzen: verständlicher
deutscher Hinweis, dass (a) eine pseudonyme Blockchain-Spur entsteht, die technisch nicht
gelöscht werden kann, (b) wir bei Austritt die Verknüpfung zur Person vollständig löschen,
(c) Attestierung durch andere Einwohner erfolgt (soziale Kenntnisnahme). Gleicher Text in
die Datenschutzerklärung.

### 2.3 Was bewusst NICHT gelöscht wird

Die On-Chain-Event-Historie (Mint/Revocation/Sign-ups/Transfers). Begründung: technisch
unmöglich auf fremder Chain + nach Brückenlöschung anonymisiert i. S. v. EDPB § 103.
Diese Begründung gehört wörtlich in DPIA + Datenschutzerklärung.

---

## 3. Verkettungsrisiko — Lösungspfad

**Problem:** Dieselbe Smart-Account-Adresse ist Identitäts-, Zahlungs-, Governance- und
Messaging-Identität. Forschung zeigt: wenige öffentliche Token machen eine Wallet nahezu
eindeutig fingerprintbar; bei uns kommt der Circles-Zahlungsgraph dazu. Zusammen mit dem
Art.-9-Risiko (Teilnahme an politischen Abstimmungen) ist das unser größtes strukturelles
Datenschutzrisiko.

**Maßnahmen in Prioritätsreihenfolge:**

1. **Sichtbarkeit minimieren (sofort, billig):** Governance-Teilnahme-Metadaten (wer hat
   sich für Poll X registriert) nirgends in UI/API aggregiert anzeigen; UI-Regel „keine
   Wallet-Adressen" beibehalten; öffentliche Profile zeigen keine On-Chain-Historie.
2. **`vote_history`-Klartext-Leak fixen (kurzfristig):** bekannter Befund aus dem
   ZK-Assessment 2026-07-09 — die Off-Chain-DB darf das nicht unterlaufen, was MACI
   on-chain schützt.
3. **Semaphore-Pfad für Teilnahmenachweise (mittelfristig):** Zugehörigkeitsbeweis
   („ist attestierter Bürger") per ZK-Proof aus einem Anonymity-Set statt per
   NFT-Adress-Lookup — Grundlagen liegen im Repo
   ([SEMAPHORE_README](SEMAPHORE_README.md), [Usage Guide](SEMAPHORE_USAGE_GUIDE.md)).
   Entkoppelt Berechtigungsprüfung von der identifizierbaren Adresse.
4. **Wallet-Trennung Identität ↔ Zahlung (langfristig, Trigger nötig):** separate Accounts
   für Citizen-NFT/Governance und Circles-Zahlungen. Teuer (UX, Gas-Sponsoring,
   Trust-Graph-Migration) → als [Roadmap-Eintrag mit Trigger](ROADMAP_AND_DEFERRED.md)
   führen, z. B. „Trigger: >200 aktive Nutzer oder aufsichtliche Beanstandung".

---

## 4. ⚠️ AKUT: AI Act Art. 50 — Transparenzpflichten ab 2026-08-02 **[Gesetz]**

VO (EU) 2024/1689; Art.-50-Pflichten anwendbar ab **2026-08-02**; Sanktionen bis
15 Mio. €/3 % Weltumsatz. Der Verein ist für Mecky **Provider und Deployer** zugleich
(wir bauen das System auf der Claude-API und betreiben es). Deutsches Durchführungsgesetz
(Aufsicht, voraussichtlich BNetzA) Mitte 2026 noch nicht final **[Offen]**.

### 4.1 Betroffene Oberflächen und Pflichten

| Oberfläche | Pflicht | Maßnahme |
|---|---|---|
| **Mecky-Chat** (Expo `app/mecky.tsx`, Web) | Art. 50(1): KI-Offenlegung spätestens bei Erstinteraktion | Dauerhafter Hinweis „Mecky ist eine KI" im Chat-Header + Erstnachricht; nicht nur im Impressum |
| **KI-Newsroom / Story Engine** (Feed + Blog) | Art. 50(4) UAbs. 2: KI-generierte Texte, die die Öffentlichkeit über Angelegenheiten öffentlichen Interesses informieren, sind offenzulegen — **außer** ein Mensch trägt redaktionelle Verantwortung nach Prüfung | Pro Story sichtbares Label „Mit KI erstellt" **oder** dokumentierter menschlicher Redaktions-Check mit benannter verantwortlicher Person; Empfehlung: beides |
| **Newsletter** (AI weekly, Resend) | wie Newsroom | Label im Footer + Redaktionsverantwortliche:r |
| **Generierte Bilder** (Flyer-Generator, Menü-Bilder, Mini-App-Store-Bilder — kie.ai `nano-banana-2-lite`) | Art. 50(2): **maschinenlesbare** Kennzeichnung synthetischer Inhalte durch den Provider | Metadaten-Kennzeichnung beim Erzeugen einbetten (C2PA/IPTC `DigitalSourceType=trainedAlgorithmicMedia`; pragmatisch: EXIF/XMP-Feld in `lib/images/kie.ts`-Pipeline setzen) + sichtbares „KI-generiert"-Badge, wo Bilder öffentlich erscheinen |
| **Mecky-Outreach-E-Mails** (Fördermittel) | 50(1) sinngemäß + Lauterkeit | Fußzeile „Diese E-Mail wurde KI-unterstützt erstellt; verantwortlich: [Verein/Person]" — Banded-Honest-Report-Ansatz passt bereits |
| **Event-Stories-Audio / TTS** (falls aktiv) | 50(2)/(4) | wie Bilder: maschinenlesbar + sichtbar kennzeichnen |

### 4.2 Umsetzungsplan **[TODO — Frist 2026-08-02]**

1. Mecky-Disclosure in Expo + Web (ein UI-String + Erstnachricht) — kleinster Aufwand,
   größte Sichtbarkeit.
2. Zentrale Kennzeichnungs-Helper in der Bild-Pipeline (`apps/web/src/lib/images/kie.ts` +
   Edge Functions `generate-menu-image`, Flyer-Generator): XMP/C2PA-Metadaten + Badge-Flag
   im Datensatz, damit alle Render-Stellen das Badge anzeigen können.
3. Story-Engine/Newsletter: Label-Komponente + Feld `ai_generated` an Story/Newsletter,
   Redaktionsverantwortliche:n benennen.
4. Kurzer Vermerk in der Datenschutzerklärung/Impressum (eingesetzte KI-Systeme, Zwecke).
5. Nicht vergessen: **KI-Kompetenz-Pflicht (Art. 4)** gilt seit 2025-02-02 — kurze interne
   Notiz, wer die Systeme betreut und wie Missbrauch gemeldet wird, genügt bei unserer Größe.

Mecky ist **kein Hochrisiko-System** (Annex III), solange er nicht über Leistungsansprüche
o. Ä. entscheidet — bei künftigen „agentischen" Mecky-Fähigkeiten (Outbound Runtime,
Verwaltungshandeln) vor Launch erneut prüfen.

---

## 5. Flankierende Selbsteinstufungen (Kurzform)

- **Kein CASP / keine AMLR-„obliged entity"** (AMLR ab 2027-07-10): wir verwahren keine
  Nutzer-Keys, betreiben keinen EUR↔Münzen-Umtausch, Fiat läuft über regulierte Dritte
  (Monerium EMI, Stripe). **Kipppunkte** (jährlich gegenprüfen): Umtauschgeschäft,
  Key-Verwahrung, Zahlungsvermittlung. Details:
  [Landschafts-Recherche §5](future-research/2026-07-29_ITPLR_BLOCKCHAIN_REGULATORY_LANDSCAPE.md#5-röbel-münzen-unter-mica-sicheres-design-bekannte-kipppunkte),
  [Legal Masterplan](future-research/LEGAL_MASTERPLAN.md).
- **Kommunalrecht M-V:** Abstimmungen sind **konsultative Einwohnerbeteiligung**
  (§ 16 KV M-V „andere geeignete Formen"), niemals Bürgerentscheid-Semantik (§ 20 mit
  Quoren + geheimer Wahl kann eine App nicht erfüllen). Wording überall: „Meinungsbild",
  nicht „Abstimmung der Gemeinde". Für formale Wirkung: Papierweg § 18 Einwohnerantrag
  (5 % oder 2.000 Unterschriften), App nur zur Mobilisierung. Bei städtischer Übernahme:
  Hauptsatzung/Beteiligungsleitlinien + analoger Parallelkanal.
- **Aufsichtskontakt (optional, empfohlen):** European Blockchain Sandbox / Vorab-Kontakt
  LfDI M-V — schafft Aufsichtssicherheit, die es mangels Präzedenzfällen nicht gibt.

## 6. Prioritäten

| # | Aktion | Frist | Aufwand |
|---|---|---|---|
| 1 | AI-Act-Disclosure Mecky + Kennzeichnung generierter Inhalte (§ 4.2) | **2026-08-02** | S–M |
| 2 | `vote_history`-Klartext-Leak fixen | kurzfristig | S |
| 3 | Löschpfad als Runbook + einmal testweise durchspielen (§ 2.1) | Q3 2026 | M |
| 4 | Pre-Mint-Aufklärung im Onboarding + Datenschutzerklärung (§ 2.2) | Q3 2026 | S |
| 5 | DPIA formalisieren (aus § 1), AV-Verträge inventarisieren | Q3/Q4 2026 | M |
| 6 | Governance-Metadaten-Sichtbarkeit minimieren (§ 3.1) | laufend | S |
| 7 | Relay: NIP-09/62 → echte LMDB-Löschung (auch Mirror) + DSA-Meldeweg/Abuse-Kontakt (§ 2.1 Nr. 4) | Q3 2026 | S–M |
| 8 | Semaphore-Teilnahmenachweise (§ 3.3) | Trigger: ZK-Roadmap | L |
