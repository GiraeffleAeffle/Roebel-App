# Datenschutz-Folgenabschätzung (DPIA) — Röbel App

| | |
|---|---|
| **Verantwortlicher** | Röbel App / M. Brych (bei Vereinsgründung: auf den e. V. übertragen) |
| **Version / Datum** | 1.0-ENTWURF · 2026-07-31 |
| **Status** | **Entwurf** — inhaltlich vollständig aus Code/Migrationen abgeleitet; vor Verwendung gegenüber Aufsicht/Externen durch eine Datenschutz-Kanzlei prüfen lassen |
| **Turnus** | laufende DPIA (EDPB 02/2025 § 99): fortschreiben bei jeder neuen On-Chain-/Nostr-Verarbeitung, neuem KI-System, neuem Auftragsverarbeiter |

> Kurzfassung und operative Ableitungen: [DSGVO_AI_ACT_COMPLIANCE.md](DSGVO_AI_ACT_COMPLIANCE.md).
> Löschverfahren: [DELETION_RUNBOOK.md](DELETION_RUNBOOK.md).
> Rechtslage-Recherche: [future-research/2026-07-29_ITPLR_BLOCKCHAIN_REGULATORY_LANDSCAPE.md](future-research/2026-07-29_ITPLR_BLOCKCHAIN_REGULATORY_LANDSCAPE.md).

---

## 1. Anlass und Erforderlichkeit der DPIA

Art. 35 Abs. 1 DSGVO: voraussichtlich hohes Risiko durch (a) Einsatz **neuer Technologien**
(öffentliche permissionless Blockchain, kryptografische Abstimmungen/MACI, dezentrales
Publikationsprotokoll/Nostr), (b) Verarbeitung, die **politische Teilnahme** indizieren kann
(Art.-9-Nähe), (c) dauerhafte, nicht revidierbare Speicherung. Die EDPB Guidelines 02/2025
(final, 2026-07-07) verlangen für Blockchain-Verarbeitungen ausdrücklich eine DPIA mit
blockchain-spezifischen Prüfpunkten (§§ 97–99) — diese Struktur wird hier befolgt.

## 2. Systematische Beschreibung der Verarbeitung (Art. 35 Abs. 7 lit. a)

### 2.1 On-chain (Gnosis Chain — öffentlich, permissionless, unlöschbar)

| Verarbeitung | Vertrag/System | Daten |
|---|---|---|
| Bürger-Status (Soulbound-NFT) | CitizenNFTv2 `0x59aA26…` | Wallet-Adresse ↔ Status „verifizierte:r Einwohner:in" |
| Attester-Status, Attestierungs-/Entzugs-Events | AttesterNFTv2 `0xC587F3…` | wer wen bestätigt/entzogen hat (Event-Logs, pseudonym) |
| Abstimmungs-Registrierung + verschlüsselte Stimmen | MACI `0x6663eD…` | Teilnahme-Metadaten sichtbar; **Stimminhalt kryptografisch verborgen** |
| Vorschläge, Ergebnisse | Governor `0x5F5e49…` | Proposer-Adresse, Tallies |
| Gemeinschaftswährung | Circles-Gruppe `0xAc2C…` | Zahlungsgraph (pseudonym) |
| Spenden | Safe + EURe V2 | Spender-Adressen |

**Grundsatz:** on-chain stehen ausschließlich pseudonyme Adressen, Status und Commitments —
keine Namen, keine Klartext-Daten, keine Hashes personenbezogener Payloads.

### 2.2 Nostr (eigener Relay `relay.roebel.app` + Föderations-Mirror + Index)

Opt-in-Publikation ohnehin öffentlicher App-Inhalte (kind-0-Profile, kind-1-Posts),
signiert mit wallet-abgeleitetem Schlüssel. Die Zuordnung Wallet↔npub liegt ausschließlich
in der zugriffsgesperrten Tabelle `nostr_identities` (RLS ohne Policies + REVOKE).
KI-Agenten-Beiträge sind maschinenlesbar gekennzeichnet (`bot: true`, `netizen_agent`).

### 2.3 Off-chain — die löschbare Identitätsbrücke (Supabase)

Nutzerkonten (Wallet ↔ E-Mail via thirdweb-Login, Anzeigename), Antrags-/Attestierungsdaten
(Name, Adresse, Geburtsdatum — Ende-zu-Ende-verschlüsselt für die Attester),
Consent-Präferenzen + Audit-Log (Policy-Version 1.1.0), Teilnahme-Mirror `vote_history`
(**nur Teilnahme — die Stimmwahl wird seit 2026-07-31 weder gespeichert noch an Analytics
gesendet**), Inhalte (Posts, Kommentare, Events), Push-Tokens, Punkte/Münzen-Caches,
Mecky-Chats. Vollständige Tabellenliste = Sweep der `delete-user-account`-Funktion
(Stand 2026-07-31).

### 2.4 KI-Systeme

Mecky (Claude/Anthropic; permanent als KI gekennzeichnet, Einwilligungs-Kategorie
`ai_assistant`), Story-/Newsletter-Ko-Erstellung (sichtbar gelabelt, redaktionell geprüft),
Bildgenerierung (maschinenlesbar IPTC `trainedAlgorithmicMedia` markiert). Keine
automatisierten Einzelentscheidungen i. S. v. Art. 22.

## 3. Zwecke und Rechtsgrundlagen (Art. 35 Abs. 7 lit. a/b)

| Verarbeitung | Zweck | Rechtsgrundlage |
|---|---|---|
| Citizen/Attester-NFT | sybil-resistente, überprüfbare Teilnahmeberechtigung | Art. 6(1)(a) — informierte Einwilligung vor Antrag (`ChainRecordNotice` an beiden Antragspfaden) |
| MACI-Abstimmungen | konsultative Bürgerbeteiligung („Meinungsbild", § 16 KV M-V) | Art. 6(1)(a); Stimminhalt by design nicht lesbar |
| Nostr-Publikation | offener, überprüfbarer öffentlicher Datenbestand | Art. 6(1)(a) — Public-Record-Consent (Policy 1.1.0), Dauerhaftigkeit vorab erklärt |
| Münzen/Punkte/Engagement | Gemeinschaftswährung, Anerkennung | Art. 6(1)(b) |
| Mecky/KI-Inhalte | Information, Assistenz | Art. 6(1)(a) (`ai_assistant`) bzw. (1)(f) |
| Push/Analytics/Crash | Betrieb, Verbesserung | Art. 6(1)(a) — getrennte Consent-Kategorien, PostHog nur nach Einwilligung |

Einwilligungs-Widerruf ⇒ Anonymisierungspflicht (EDPB § 71) → umgesetzt über das
[Löschverfahren](DELETION_RUNBOOK.md).

## 4. Empfänger und Auftragsverarbeiter — AV-Inventar (Art. 28)

**Status-Spalte: ☐ = AVV/Transfer-Nachweis noch zu verifizieren und abzulegen [TODO].**

| Dienst | Funktion | Daten | Sitz/Region | Transfer-Basis | AVV |
|---|---|---|---|---|---|
| Supabase | DB, Auth, Edge Functions | Identitätsbrücke, Inhalte | Projektregion prüfen (EU angestrebt) | DPF/SCC | ☐ |
| thirdweb | Wallet-Infrastruktur (In-App-Wallet) | E-Mail↔Wallet, Key-Shards | USA | SCC/DPF | ☐ |
| Anthropic | Mecky (Claude) | Chat-Inhalte | Irland/USA | AVV + SCC (lt. Datenschutzerklärung 1.1) | ☐ Nachweis ablegen |
| kie.ai | Bildgenerierung | Prompts, Referenzbilder | prüfen | prüfen | ☐ |
| PostHog | Analytics (consent-gated) | Events, pseudonyme IDs | EU-Cloud prüfen | — | ☐ |
| Expo (EAS) | Push-Zustellung | Push-Tokens | USA | SCC/DPF | ☐ |
| Resend | Newsletter | E-Mail-Adressen | USA | SCC/DPF | ☐ |
| Cloudflare | Video (Stream), CDN | Videos, IPs | global | SCC/DPF | ☐ |
| Vercel | Web-Hosting | Request-Daten | USA/Edge | SCC/DPF | ☐ |
| Fly.io | Röbel-ID-Keystone | OIDC-Sessions | Region fra, US-Anbieter | SCC/DPF | ☐ |
| Hetzner | Netizen-Node (Relay, Nextcloud) | Relay-Events, Workspace-Dateien | Deutschland | — (EU) | ☐ |

**Empfänger, die keine Auftragsverarbeiter sind:** Gnosis-Chain-Validatoren und fremde
Nostr-Relays/Peers (öffentliches Protokoll, kein Weisungsverhältnis — Daten dort sind
pseudonym und nach Brückenlöschung anonym); Monerium (eigenständiger Verantwortlicher,
EMI) und Stripe (Zahlungsdienst); XMTP-Netzwerk (E2E, Schlüssel beim Nutzer).

## 5. Drittlandtransfers (Kapitel V)

US-Dienstleister über SCC/Data-Privacy-Framework (je Anbieter verifizieren, Spalte oben).
Für Chain-/Relay-Replikation weltweit gilt: übertragene Daten sind pseudonym; für Empfänger
ohne Zugriff auf unsere Off-Chain-Brücke faktisch anonym (EuGH C-413/23 P, relativer
Personenbezug) — dokumentierte Rest-Unsicherheit, da die finale EDPB-Linie für öffentliche
Chains strenger formuliert ist **[Offen]**.

## 6. Notwendigkeit und Verhältnismäßigkeit (Art. 35 Abs. 7 lit. b, EDPB §§ 46–49)

**Warum überhaupt eine öffentliche Blockchain:** Die Kernzusage des Systems ist, dass
Abstimmungs- und Statusnachweise **auch gegenüber dem Betreiber selbst**
manipulationsresistent sind — der Verein soll Ergebnisse nicht fälschen können. Das
erfordert öffentliche Verifizierbarkeit, die eine private/permissioned Lösung des
Betreibers gerade nicht bietet; hinzu kommen Datenhoheit ohne Zentralstelle und
Forkability als Governance-Garantie für die Kommune. Abgleich mit der Checkliste des
IT-Planungsrats: [Recherche §3](future-research/2026-07-29_ITPLR_BLOCKCHAIN_REGULATORY_LANDSCAPE.md).

**Datenminimierung:** on-chain nur Adresse + Status/Commitments; Antragsdaten E2E-
verschlüsselt; Stimmwahl nirgends off-chain; UI zeigt nie Wallet-Adressen; Analytics
consent-gated und ohne Stimmdaten. **Speicherbegrenzung:** Brücke vollständig löschbar
(Runbook); On-Chain-Rest nach Löschung anonym (EDPB § 103).

## 7. Risikoanalyse (Art. 35 Abs. 7 lit. c)

Skalen: Eintritt (niedrig/mittel/hoch) × Schwere (niedrig/mittel/hoch).

| # | Risiko | Eintritt | Schwere | Maßnahmen | Restrisiko |
|---|---|---|---|---|---|
| R1 | Verkettung/Profiling: eine Adresse trägt Identität + Zahlungsgraph + Governance + Messaging | mittel | hoch | `nostr_identities` gesperrt; keine Adress-Anzeige; Governance-Metadaten nicht aggregiert angezeigt; geplant: Semaphore-ZK-Nachweise | mittel — größtes strukturelles Risiko, aktiv zu reduzieren |
| R2 | Politische Meinung ableitbar (Art.-9-Nähe) aus Teilnahme-Metadaten | mittel | hoch | MACI verbirgt Stimminhalt; `vote_history` speichert nur Teilnahme (Fix 2026-07-31); Abstimmungen als „Meinungsbild" gerahmt | niedrig–mittel |
| R3 | Permanenz: Betroffene verstehen Unlöschbarkeit nicht | mittel | mittel | `ChainRecordNotice` + Public-Record-Consent VOR der Verarbeitung; Datenschutzerklärung § 5; Löschpfad macht Rest anonym | niedrig |
| R4 | Breach der Off-Chain-Brücke (Supabase) deanonymisiert On-Chain-Historie | niedrig | hoch | RLS-Härtung, gesperrte Registry, Service-Key nur serverseitig, E2E für Antragsdaten | niedrig–mittel |
| R5 | Kleinstadt-Sozialwissen: Attester kennen Antragsteller | hoch | niedrig | systembedingt (soziales Attestierungsmodell); vorab offengelegt (Notice Punkt c) | akzeptiert, nicht technisch mitigierbar |
| R6 | Koordinator entschlüsselt Stimmen | niedrig | hoch | Shamir 3-of-5 über Attester; Schlüssel existiert zwischen Tallies nicht | niedrig |
| R7 | Drittland-/Node-Replikation | niedrig | mittel | Pseudonymie + löschbare Brücke; SCC/DPF bei Prozessoren | niedrig **[Offen: EDPB-Linie]** |
| R8 | KI-Fehlinformation unter Stadt-Identität | mittel | mittel | Art.-50-Kennzeichnung überall; Mecky-Systemprompt („nie kommunale Fakten erfinden"); Kill-Switches | niedrig–mittel |
| R9 | Kryptografie-Verfall (Quantenhorizont) | niedrig (langfristig) | mittel | keine verschlüsselten personenbezogenen Payloads on-chain — Angriffsfläche minimal | niedrig |

## 8. Ergebnis

Nach Umsetzung der Maßnahmen (Stand 2026-07-31: Prioritäten 1–4 des
[Compliance-Plans](DSGVO_AI_ACT_COMPLIANCE.md#6-prioritäten) umgesetzt) verbleibt kein
Risiko, das eine Vorab-Konsultation nach Art. 36 erforderte — **Einschätzung des
Entwurfsverfassers, durch Kanzlei zu bestätigen**. Die beiden aktiv zu treibenden
Restrisiken sind R1 (Verkettung → Semaphore-Pfad) und die Verifikation der AV-/Transfer-
Nachweise (§ 4).

## 9. Offene Punkte vor Version 1.0-FINAL

1. AVV-/Transfer-Nachweise je Dienst einsammeln und ablegen (§ 4, alle ☐).
2. Supabase-Projektregion + PostHog-Cloud-Region verifizieren.
3. Lösch-Testdurchlauf mit Testkonto (Runbook-Kopfzeile).
4. Kanzlei-Review; Benennung DSB prüfen (voraussichtlich nicht pflichtig bei aktueller
   Größe — bestätigen lassen).
5. Bei Vereinsgründung: Verantwortlichen-Angaben aktualisieren.
