# Lösch-Runbook — Art.-17-Antrag, Schritt für Schritt

> **Stand 2026-07-31.** Operative Anleitung für einen Löschantrag ("Konto und Daten
> löschen"). Das **Warum** und die Rechtslage stehen in
> [DSGVO_AI_ACT_COMPLIANCE §2](DSGVO_AI_ACT_COMPLIANCE.md) — hier steht nur das **Wie**.
> Grundprinzip: On-chain/Nostr bleibt pseudonym stehen; gelöscht wird die **Brücke zur
> Person**. Ist sie weg, ist die verbleibende Spur effektiv anonym (EDPB 02/2025 § 103).
>
> ⚠️ **Testdurchlauf steht aus.** Dieses Runbook wurde aus Code und Migrationen abgeleitet,
> aber noch nie end-to-end an einem echten Konto durchgespielt. Der erste Durchlauf (mit
> einem Testkonto) ist Priorität — ein ungetesteter Löschpfad ist keiner.

---

## Schritt 0 — Antrag entgegennehmen und Identität prüfen

- **Self-Service (Normalfall):** Der Nutzer löscht in der App (Einstellungen → Konto
  löschen). Die App signiert `delete-account:<wallet>:<unix-sekunden>` mit der eigenen
  Wallet und ruft die Edge Function auf — Identitätsnachweis ist die Signatur, nichts
  weiter nötig.
- **Manueller Antrag (E-Mail/Brief):** Identität prüfen, indem der Antragsteller
  nachweislich über den App-Zugang verfügt (z. B. eine in der App angezeigte
  Bestätigungsaktion) — **niemals** allein auf eine genannte Wallet-Adresse hin löschen.
- Eingang mit Datum protokollieren (Frist: unverzüglich, spätestens ein Monat,
  Art. 12 Abs. 3).

## Schritt 1 — VOR der Löschung: npub festhalten

Die Relay-Bereinigung (Schritt 3) braucht den Nostr-Pubkey des Nutzers — der steht **nur**
in `nostr_identities` und ist nach Schritt 2 weg. Deshalb zuerst (Service-Role/SQL-Editor):

```sql
select npub, pubkey_hex from nostr_identities where wallet_address = '<wallet lowercase>';
```

Kein Treffer = Nutzer hat nie an Nostr teilgenommen → Schritt 3 entfällt.

## Schritt 2 — Supabase: die Edge Function

[`delete-user-account`](../apps/expo/supabase/functions/delete-user-account/index.ts) ist
die kanonische Implementierung; **ihre Tabellenliste ist die Quelle der Wahrheit** (Stand
2026-07-31 erweitert um `nostr_identities`, `workspace_sessions`/`_actions`,
`muenzen_tips` beide Richtungen, `mecky_conversations` (+ kaskadierende Messages),
`mecky_outreach_log`, `push_tokens`; `flyers.created_by_wallet` wird anonymisiert statt
gelöscht, damit Org-Inhalte den Weggang ihres Erstellers überleben). Sie löscht außerdem
allein-gehaltene Org-Accounts und zuletzt die User-Zeile (Kaskaden: Posts, Kommentare,
Likes, Punkte, Stempelkarten …).

- Self-Service: passiert automatisch beim App-Flow.
- Manueller Antrag ohne App-Zugang: dieselben Statements per Service-Role ausführen —
  an der Tabellenliste der Funktion entlang, nicht aus dem Gedächtnis.
- Löschung von `nostr_identities` entfernt den npub beim nächsten Sync-Pass automatisch
  von der Relay-Allow-List (fail-closed Syncer) — Schreibrecht ist damit entzogen.

## Schritt 3 — Nostr: eigenes Relay, Mirror und Index bereinigen

Auf der Hetzner-Box (beide LMDB-Stores — Authoring-Relay **und** Föderations-Mirror):

```bash
# Events des Autors löschen (Syntax vor erstem Einsatz gegen die installierte
# strfry-Version prüfen — `strfry delete --help`):
strfry delete --filter '{"authors":["<pubkey_hex>"]}'
strfry --config <mirror-config> delete --filter '{"authors":["<pubkey_hex>"]}'
```

Danach den **Index** bereinigen (derived view, per Design neu aufbaubar): Zeilen des
Autors in der Indexer-Postgres löschen. Optional, empfohlen: vor der Löschung ein
NIP-09-Delete (bzw. künftig NIP-62 „Request to Vanish") über die bekannten Relays
publizieren, damit auch föderierte Kopien bei Peers die Löschanfrage sehen — durchsetzbar
ist sie nur bei uns, und genau das sagt die Datenschutzerklärung (1.1) auch.

## Schritt 4 — Drittsysteme

| System | Aktion |
|---|---|
| **thirdweb** | Konto-/Datenlöschung anstoßen (E-Mail↔Wallet-Mapping liegt beim Prozessor) — Dashboard/Support |
| **PostHog** | Person + Events zum Distinct-ID (Wallet) über die GDPR-Delete-API löschen |
| **Circles-Profildienst** | Profil (Name/Avatar) zum Account löschen/zurücksetzen |
| **Resend** | Newsletter-Kontakt löschen (falls abonniert) |
| **Cloudflare Stream** | Videos des Nutzers löschen (Upload-Historie prüfen) |
| **Nextcloud** (falls Arbeitsbereich genutzt) | `occ user:delete <sub>` im Container; Röbel-ID-Seite: `oidc_payloads`-Zeilen des `sub` löschen |
| **XMTP** | Keys sind client-seitig (Gerät des Nutzers); unsere Registry-Zeilen fallen unter Schritt 2 |

## Schritt 5 — Abschluss

1. **Backups:** Löschung greift in der Backup-Rotation erst nach Ablauf des
   Aufbewahrungsfensters **[TODO: Supabase-PITR-/Backup-Frist ermitteln und hier
   eintragen]** — im Bestätigungstext erwähnen.
2. **Protokollieren** (Art. 5 Abs. 2): Datum, geprüfte Identität, ausgeführte Schritte,
   npub (für den Nachweis der Relay-Bereinigung), offene Fristen.
3. **Bestätigung an den Betroffenen**, inkl. des Satzes aus
   [DSGVO_AI_ACT_COMPLIANCE §2.3](DSGVO_AI_ACT_COMPLIANCE.md): Die pseudonyme
   On-Chain-/Nostr-Historie ist technisch unlöschbar bzw. bei Dritten außerhalb unserer
   Kontrolle; durch die Löschung aller Zuordnungsdaten bei uns ist sie keiner Person mehr
   zuordenbar. Kopien auf fremden Relays/Peers liegen außerhalb unserer Verantwortung.

## Bekannte Lücken (beim nächsten DB-Zugriff verifizieren)

- `conversations`: Wallet-Spalten teils **checksummed** (Memory 2026-07) — prüfen, ob der
  Sweep sie erfasst (ilike) oder Zeilen stehen bleiben.
- Storage-Buckets (Avatare, Post-Bilder): Objekte des Nutzers löschen — nicht Teil der
  Edge Function.
- `notifications`-Tabelle (Push-Hub): Zeilen mit Empfänger-/Absender-Wallet.
- **NIP-62-Support serverseitig** (strfry-Plugin/Cron) — siehe Compliance-Prioritäten.
- **GATE:** Die erweiterte `delete-user-account`-Funktion muss neu deployed werden
  (`supabase functions deploy delete-user-account`), sonst läuft produktiv noch der
  Stand vom 2026-05-22 ohne `nostr_identities`.
