# IT-Planungsrat „Blockchain" (2020) → Regulatorische Landschaft 2026

> **Recherche vom 2026-07-29.** Ausgangspunkt: [Sachstandsbericht Mai 2020 des
> Koordinierungsprojekts „Blockchain" des IT-Planungsrats](https://www.it-planungsrat.de/fileadmin/beschluesse/2020/Beschluss2020-33_Anlage_Blockchain.pdf)
> (Anlage zu Beschluss 2020/33) plus drei parallele Recherchepässe zum Stand Juli 2026
> (eIDAS 2.0/EUDI, Datenschutz/Recht, MiCA/kommunale Token/Förderung).
> Operative Konsequenzen (DPIA, Löschpfad, AI Act) stehen in
> [`../DSGVO_AI_ACT_COMPLIANCE.md`](../DSGVO_AI_ACT_COMPLIANCE.md);
> Entity-/Treasury-/Spendenrecht im [`LEGAL_MASTERPLAN.md`](LEGAL_MASTERPLAN.md).
> Kennzeichnung: **[Gesetz]** = geltendes Recht, **[Leitlinie]** = Aufsichtspraxis,
> **[Pilot]** = Projektpraxis, **[Offen]** = ungeklärt/Einschätzung.

---

## 1. Was der 2020er-Bericht sagte

Der Bericht („Neues Verwaltungs-Ökosystem", 24 S.) empfahl:

1. **W3C Verifiable Credentials + Self-Sovereign Identity** als universelle Technik für
   digitale Identitäten und Nachweise (Impfausweis, Zeugnisse, Parkausweis …), gespeichert
   in einer „digital identity wallet" beim Bürger.
2. **eIDAS-Integration** (qeS, Siegel, Zeitstempel „blockchain-native").
3. **EBSI/ESSIF** als europäische Infrastruktur, an der Deutschland andocken solle.
4. Eine **Checkliste für Blockchain-Anwendungsfälle** (14 fachliche + technische Fragen,
   S. 11–12) plus Empfehlung *private permissioned* Designs für den zwischenbehördlichen Einsatz.
5. Beispiele: Zeugnisvalidierung (NRW), OSiP-Zuverlässigkeitsprüfung, KfZ-Zulassung
   (Stadt Hamm), BAMF-Asyl-Blockchain, **Wiener Kultur-Token** als kommunales
   Benefit-System, Energie (WSW Tal.Markt), **govdigital eG** als öffentlicher
   Blockchain-Betreiber (BIaaS/BaaS).

## 2. Was daraus bis 2026 wurde: Der Staat hat den Blockchain-Pfad verlassen

| 2020er-Empfehlung | Stand Juli 2026 |
|---|---|
| W3C VC + SSI | **EUDI-Wallet gewann — ohne DLT.** Formate: SD-JWT VC + mdoc/ISO 18013-5; W3C VC nur optional, nicht für qualifizierte Attestierungen ([ARF](https://eudi.dev/1.4.0/arf/)). SSI-Schaufensterprojekte (IDunion etc.) liefen Ende 2024 aus. |
| eIDAS-Integration | **eIDAS 2.0 (VO (EU) 2024/1183) in Kraft seit 20.05.2024 [Gesetz].** Staatliche Wallet-Pflicht ~Dez. 2026; Relying-Party-Akzeptanzpflicht ~Ende 2027. Deutschland: Sandbox seit 27.01.2026, Pilot Okt/Nov 2026, **Start 02.01.2027** ([eudi-wallet.gov.de](https://eudi-wallet.gov.de/ueber), [netzpolitik-FAQ](https://netzpolitik.org/2026/faq-zur-eudi-wallet-die-wichtigsten-fragen-und-antworten-zur-digitalen-brieftasche/)). PID via nPA; Bundesdruckerei/D-Trust bauen den PID-Provider. Private Wallets zertifizierbar ~2028. |
| EBSI/ESSIF | In **EUROPEUM-EDIC** überführt (Mai 2024) — **ohne deutsche Beteiligung**; Nische Bildungsnachweise, Produktivstart erst Q4 2026 geplant ([europeum.eu](https://europeum.eu/)). ESSIF als Marke verschwunden. |
| Koordinierungsprojekt | Nach 2021 ausgelaufen; **kein Blockchain-/SSI-Projekt mehr im IT-PLR-Portfolio**. Strategische Linie 2026: „Deutschland-Stack" (Beschluss 49. Sitzung, 18.03.2026), technologieneutral. |
| govdigital eG | **Blockchain de facto aufgegeben.** Portfolio heute: Deutsche Verwaltungscloud (produktiv seit 04/2025), KI, Cybersecurity, EfA-Marktplatz ([govdigital.de](https://govdigital.de/)). Schulzeugnis-Blockchain-Pilot (2021) eingestellt → Umschwenk auf EUDI-Wallet-/VC-Signaturbasis. |
| Zeugnisvalidierung | Läuft heute als „Digitale Bildungsnachweise" (RLP + Niedersachsen pilotieren Abiturzeugnisse), Bereitstellung **über die EUDI-Wallet ab 2027**, Open Source auf openCode — ohne Blockchain ([BMBFSFJ](https://www.bmbfsfj.bund.de/bmbfsfj/digitale-bildungsnachweise-285310)). |
| BAMF-Projekt | **Einzige produktive Bund-Blockchain: FLORA** (seit 2018, produktiv in 8 Ländern **inkl. MV**, Kosten 25,7 Mio. € = >5× Schätzung; Ausbau den Haushaltskürzungen 2024 zum Opfer gefallen) ([netzpolitik](https://netzpolitik.org/2026/bamf-ueber-25-millionen-euro-fuer-eine-asyl-blockchain/)). |
| Registermodernisierung | **NOOTS-Staatsvertrag in Kraft seit 01.02.2026 [Gesetz]** (13/16 Länder); Nachweisabruf registerbasiert über die IDNr (Steuer-ID) — keine Blockchain. OZG-ÄndG seit 24.07.2024; BundID → DeutschlandID; EUDI-Wallet wird als Login getestet. |
| Wiener Kultur-Token | **Dauerpilot, nie Regelbetrieb.** Phase 1 (2020) COVID-gestoppt; Phase 2 (ab 04/2024) **ohne Blockchain-Komponente**; keine publizierte Endauswertung ([digitales.wien.gv.at](https://digitales.wien.gv.at/kultur-token-ist-zurueck/)). De-facto-Nachfolger: **Klima-Taler** (MotionTag, 50+ Städte) — zentralisierte SaaS-App ohne Token-Infrastruktur. |

**Konvergenzbefund:** Verwaltung Deutschland = Register + Cloud + PKI/Wallet-Kredentiale.
Blockchain überlebte im Staat nur dort, wo sie vor 2021 produktiv wurde (FLORA).

## 3. Die Checkliste aus dem Bericht, auf Röbel angewandt

Das bleibend Wertvolle am Dokument. Röbel trifft die „Ja"-Kriterien fast vollständig:

| # | Kriterium (verkürzt) | Röbel |
|---|---|---|
| 1 | Transparenz zwischen Behörden/Bürgern erhöhen | ✅ öffentliche Proposals, on-chain Tally |
| 2 | Manipulationsresistente Nachweise | ✅ Citizen/Attester-NFTs, MACI-Proofs |
| 3 | Einfache, sichere Überprüfbarkeit | ✅ jeder kann Verifikation nachrechnen |
| 5 | Verteilte Lösung, föderale Strukturen | ✅ forkbarer Stack (Netizen-These) |
| 6 | Datenhoheit ohne Zentralstelle | ✅ Self-Custody Smart Accounts, Verein statt Plattform |
| 7 | Automatisierte Teilprozesse | ✅ Timelock/Governor, Auto-Invite-Worker |
| 11 | Geringe Datenmengen, geringe Echtzeitanforderung | ✅ Governance-Events, keine Massendaten |
| 12 | Redundanz/Ausfallsicherheit wichtig | ✅ Gnosis-Chain-Konsens |
| 14 | Gemeinsamer Betrieb/Weiterentwicklung | ✅ AGPL, Fork-Blueprint |

**Nutzen:** Für Förderanträge/Verwaltungsgespräche die eigene Architektur an dieser
**offiziellen IT-PLR-Checkliste** entlanglegen. Bewusste Abweichung benennen: Der Bericht
empfiehlt private/permissioned; Röbel fährt public/permissionless — Begründung
Bürger-Souveränität + Forkability, abgesichert über die Maßnahmen in
[`../DSGVO_AI_ACT_COMPLIANCE.md`](../DSGVO_AI_ACT_COMPLIANCE.md).

## 4. EUDI-Wallet: wichtigster strategischer Anschlusspunkt (2026–2028)

Die EUDI-Wallet ist die Nachfolgerin der SSI-Vision des Berichts — und das
`attestationSource`-Feld im CitizenNFTv2 (Self.xyz-Phase-2-Pfad) zeigt bereits in diese
Richtung. Konkret:

- **Jetzt möglich:** EUDI-**Sandbox** (seit 27.01.2026, offen für Verwaltungen und
  Unternehmen) über das [Ecosystem Knowledge Centre](https://bmi.usercontent.opencode.de/eudi-wallet/eidas2/ecosystem_knowledge_centre/).
  Röbel als **Relying Party**: Wohnsitz-/Altersnachweis aus der Wallet als alternative bzw.
  stärkere Citizen-Attestierung neben dem sozialen Attester-Verfahren.
- **Perspektivisch:** Aussteller **nicht-qualifizierter Attestierungen** („Bürger:in von
  Röbel", Ehrenamtskarte) — das Muster des Dresden-Piloten (Dresden-Pass + sächsische
  Ehrenamtskarte in der Wallet, Q3/Q4 2026). **Stralsund ist EUDI-Pilotkommune, MV hatte
  den IT-PLR-Vorsitz** — naheliegende Ansprechpartner ([Städtetag-Positionspapier 2026](https://www.staedtetag.de/positionen/positionspapiere/2026/positionspapier-kommunen-als-schluessel-zur-erfolgreichen-einfuehrung-der-eudi-wallet)).
- **Technische Vorbereitung:** OpenID4VP/OpenID4VCI + SD-JWT VC als Schnittstellenformate
  einplanen; NFT-Verifikation nicht als einzigen Identitätsanker ausbauen. Eigene
  Wallet-Zertifizierung ist unrealistisch (LoA high, frühestens ~2028) — der praktikable
  Weg ist **Verifier/Aussteller**, nicht Wallet-Anbieter.
- Relying-Party-Registrierung (nationales Register, Aufsicht Bundesnetzagentur) und die
  Akzeptanzpflichten ~Ende 2027 im Blick behalten. Deutsches **Digital-Identitäten-Gesetz
  (DIdG)**: Kabinettsbeschluss 20.05.2026, noch im parlamentarischen Verfahren **[Offen]**.

## 5. Röbel Münzen unter MiCA: sicheres Design, bekannte Kipppunkte

- MiCA voll anwendbar seit 30.12.2024 **[Gesetz]**; deutsche Umsetzung FinmadiG/KMAG,
  Aufsicht BaFin.
- CRC-artige Token: **kein EMT** (keine Euro-Bindung, Demurrage, kein Rücktausch), **kein
  ART**; ohne Verkauf gegen Entgelt kein whitepaper-pflichtiges öffentliches Angebot
  (Ausnahmen Art. 4(2)/(3) MiCA: u. a. kostenlose Angebote, begrenzte Netze). Erwägungsgrund
  22: vollständig dezentrale Dienste außerhalb des Anwendungsbereichs **[Offen]** — bei
  Circles mintet jeder Mensch seine eigenen CRC, es gibt kein zentrales Angebot.
- **Keine offizielle MiCA-Position von Circles/Gnosis auffindbar** (Stand 07/2026) — die
  Eigenanalyse ist der Stand der Dinge und sollte dokumentiert bleiben.
- Regiogeld-Präzedenz: **Chiemgauer** = euro-gedeckter **Gutschein** über Trägerverein
  (Regios eG); BaFin-Praxis zu Stadtgutscheinen: E-Geld-Geschäft, außer die
  ZAG-Bereichsausnahme „begrenzte Netze" greift (EBA/GL/2022/02); Anzeigepflicht ab
  1 Mio. € Volumen/12 Monate.
- **Kipppunkte, die das Regime ändern würden:**
  1. Euro-Peg oder Rücktausch einführen → E-Geld-/EMT-Fragen;
  2. aktiver Verkauf gegen Entgelt → MiCA Titel II (Whitepaper);
  3. Einlösung bei Händlernetz > 1 Mio. €/Jahr → Anzeigepflicht (ZAG/Art. 4(3) MiCA);
  4. Verwahrung von Nutzer-Keys oder EUR↔Münzen-Umtausch durch den Verein → CASP-Perimeter.
- **EURe/Monerium:** EMI seit 2019, unter MiCA autorisierter EMT-Emittent mit Whitepaper;
  V2-Verträge seit 12/2024 (Repo seit 2026-07-15 auf V2). Empfang/Halten von EMTs ist
  lizenzfrei; Rücktausch braucht KYB-Konto; **kein Yield auf EMT-Bestände anbieten**
  (MiCA-Zinsverbot). Achtung: **MiCA-Stablecoin-Review 2026 läuft** — EMT-Regeln können
  sich ändern **[Offen]**.

## 6. Lehren aus den kommunalen Token-Pilotprojekten 2020–2026

Überlebt haben: (a) euro-gedeckte Gutscheinvereine (Chiemgauer, ~7 Mio. €/Jahr),
(b) zentrale SaaS-Bonus-Apps (Klima-Taler, 50+ Städte), (c) Open-Source-Plattformen ohne
Token (CONSUL 30+ deutsche Kommunen, stadtnavi). Gestorben/stagniert: Blockchain-Piloten
der Verwaltung (Kultur-Token = Dauerpilot, Bologna „Smart Citizen Wallet" nach
Social-Credit-Debatte versandet) und subventionsabhängige Systeme (Südkorea: Incheon-Cashback
07/2026 ausgesetzt, Haushalt erschöpft).

**Röbels Design vermeidet beide Haupttodesursachen:** keine E-Geld-Pflichten (kein
Rücktausch) und keine Subventionsabhängigkeit (Münzen entstehen aus dem Protokoll, nicht
aus einem Zuschusstopf). Kommunikationslehre aus Bologna: **Freiwilligkeit und Datenschutz
offensiv kommunizieren**, sonst kippt die Erzählung Richtung „Social Credit".

## 7. Positionierung & Förder-Pipeline

Der öffentlich endorsierte Stack (openCode/openDesk, CONSUL/Adhocracy+) ist durchweg
nicht-Blockchain. Daraus folgt: **nicht als „Blockchain-Verwaltungsprojekt" framen, sondern
als souveräne, quelloffene Bürger-Infrastruktur mit Wallet-Identität** — anschlussfähig an
EUDI-Wallet- und Digitale-Souveränität-Rhetorik. Token-Ökonomie ist Feature, nicht Frame.

Realistische Pipeline 2026/27:

| Programm | Fenster | Passung |
|---|---|---|
| **LEADER, LAG Mecklenburgische Seenplatte–Müritz** | lokale Aufrufe laufend prüfen (andere M-V-LAGs: Deadlines bis 31.07.2026) | Regionalentwicklung inkl. Digitales |
| **Prototype Fund** (BMFTR) | **01.10.–30.11.2026**, bis 95 T€ | beste Passung für die App („Open Source von der Gesellschaft für die Gesellschaft") |
| **DSEE 100xDigital** | Runde 2027 (2026er-IB lief 16.06.–07.07.) | Vereins-/Ehrenamtsseite, bis 20 T€ |
| **CERV Citizens' engagement** | 2027er-Call (2026er-Deadline 29.04. verpasst) | fördert explizit digitale Bürgerbeteiligung |
| **Region gestalten / BBSR** | laufende Modellvorhaben-Aufrufe | Bürgerbeteiligung als Handlungsfeld |
| **European Blockchain Sandbox / LfDI M-V** | laufend | Aufsichtssicherheit; BfDI berät dort aktiv |

Beachten: **Landtagswahl M-V 09/2026** kann Landesprogramme verschieben; Interreg
Baltic/NGI-Zero-Zyklen laufen aus, Anschlussperiode ab 2028 beobachten.

## 8. Dringendste Konsequenzen (Stand 2026-07-29)

1. **AI Act Art. 50 gilt ab 02.08.2026** — Mecky + alle Content-Agents brauchen
   KI-Disclosure und maschinenlesbare Kennzeichnung → [`../DSGVO_AI_ACT_COMPLIANCE.md`](../DSGVO_AI_ACT_COMPLIANCE.md).
2. **DPIA + dokumentierter Lösch-/Anonymisierungspfad** nach den finalen
   EDPB-Blockchain-Leitlinien (07.07.2026) — Architektur stimmt, Papierlage fehlt → dito.
3. **EUDI-Sandbox-Einstieg prüfen** (Relying Party; Kontakt Stralsund/FITKO) — der Pfad,
   den `attestationSource` bereits reserviert.
