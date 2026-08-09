# Netizen Identity Kickoff — den Keystone reif für Ortis machen (read this first)

> **Zweck:** Brief für eine frische Build-Session. Die Netizen Identity (heute: Röbel-ID-Keystone,
> `apps/roebel-id` in DIESEM Repo) wird für Ortis gereift: QR-App-Connect, Multi-Community-
> Attestations, Ortis-Client + Login-Branding. **Code-Heimat: dieses Repo** (Keystone + Expo-App);
> der Ortis-Konsument lebt im netizen_labs-Monorepo
> (`~/Documents/privat/side_projects/netizen/netizen_labs`, dort `docs/ORTIS_KICKOFF.md` §1b lesen).
> Parallel-Session-Disziplin: `git log` + status zuerst, Pathspec-Commits, die Ortis-Session baut
> gleichzeitig im netizen-Monorepo.

## 1. Audit-Stand (2026-08-09 — nicht neu herleiten, stimmt)

**Was steht (853 LOC, gut getestet):**
- **Login:** Google/Apple/Facebook + E-Mail-Code, alles über das thirdweb-Enclave-Wallet
  (`inAppWallet` + `smartAccount`, Chain 100, sponsorGas) → deterministisches Smart Account
  identisch zur Röbel-App → SIWE (ASCII-Statement-Pflicht, siwe@3-ABNF!) → `viem.verifyMessage`
  (EOA + ERC-1271 + ERC-6492). **Nebenwirkung, die eine Anforderung erfüllt: jeder
  E-Mail-Login provisioniert unsichtbar das Netizen-Account-Wallet.**
- **Claims** (`src/claims/`): `sub` = Wallet lowercase; `groups` = `citizen`/`attester` (live
  `balanceOf` auf CitizenNFT/AttesterNFT aus der Env) + `org:<accountId>:<role>` (Supabase
  `account_owners`); pseudonymer `preferred_username` (nie die Adresse — Matrix-Begründung im
  Code); `roebel:actor_type` reserviert Agenten.
- **RP-Registrierung:** first-party Clients per Env-Blöcken (Nextcloud fest, Matrix/Web optional),
  pre-granted Consent im Interaction-Router.

**Die Lücken (= der Arbeitsauftrag):**
1. Single-Community: EIN NFT-Paar aus der Env, Claims heißen `roebel:*`. Keine
   CommunityRegistry-Abfrage, kein 0..n-Communities-Claim.
2. Kein QR-/Pairing-Grant (Track A des Demos fehlt komplett).
3. Login-Seite hart „Röbel ID"-gebrandet — Ortis-Nutzer (Bürgermeister fremder Gemeinden)
   dürfen das nie sehen (ORTIS_KICKOFF §1b).
4. Kein Ortis-Client registriert; RP-Config ist pro Service hartverdrahtet.

## 1b. Stand der Umsetzung (2026-08-09) — **I1 + I2 SHIPPED**, Stop-Punkt erreicht

Commits `9abd046c` (I1), `5a7d8f48` + `323254b7` (I2), `362a0c44` (Review-Fixes) auf `main`.
60/60 Tests grün, `tsc --noEmit` sauber. **Noch NICHT deployed** — Fly-Schritt gehört Max
(§3-Regel), siehe „Max' Schritte" unten.

- **I1 ✅** Generische First-Party-RP-Liste: `loadRelyingParty(<PREFIX>)` liest jeden RP aus
  seinem Env-Block, `Config.relyingParties[]` ersetzt die Einzelfelder
  `config.nextcloud/matrix/web`. Bekannte Prefixe `NEXTCLOUD` (Pflicht) + `MATRIX`/`WEB`/`ORTIS`
  (optional, greifen bei gesetzter `<PREFIX>_CLIENT_ID`), zusätzliche über `FIRST_PARTY_RPS`.
  Provider-Client-Registry **und** die `firstPartyClientIds`-Allowlist (Auto-Consent-Grant)
  leiten sich jetzt aus **derselben** Liste ab — die Trust-Boundary wird dadurch enger, nicht
  weiter. Env-Schema vollständig in `apps/roebel-id/README.md`.
- **I2 ✅** Branding pro RP: `<PREFIX>_BRANDING` (`roebel`|`ortis`) + `<PREFIX>_BRANDING_CONTEXT`
  (freie Kontextzeile, HTML-escaped). Der anfragende `client_id` wählt das Preset.
  `roebel` rendert **byte-für-byte** wie vor der Parametrisierung (Golden-File-Test).
  `ORTIS_BRANDING` **defaultet auf `ortis`** — ein vergessener Env-Var darf keinem
  Bürgermeister „Röbel ID" zeigen.

**Zwei Korrekturen an den Annahmen dieses Dokuments** (beide bewusst, beide getestet):
1. Das SIWE-`statement` ist jetzt **pro Preset** (`roebel` unverändert `'Anmeldung bei Roebel ID'`,
   `ortis` → `'Anmeldung bei Ortis'`). Grund: der Konstant landet im `<script>`-Block **jeder**
   Login-Seite, war für Ortis-Nutzer also im Seitenquelltext sichtbar — ein ASCII-„Roebel"-Leak
   genau auf der Seite, die laut Lücke #3 nie Röbel zeigen darf. §3 verlangt nur **ASCII**, nicht
   einen eingefrorenen Text. Server-seitig unkritisch: `verify-siwe.ts` prüft Domain, chainId,
   Ablauf, Nonce und Signatur — **nie** das `statement`.
2. Ortis-Copy wörtlich aus §I2: Titel „Anmelden bei Ortis", H1 „Ortis".

**Der Pilot-Vorbehalt wurde am selben Tag zur Entscheidung — „Issuer pro Community" kommt vor:**
die Ortis-Login-Seite ist im HTML markenrein, wurde aber von `id.roebel.app` ausgeliefert.
Max hat das als für den Pilot untauglich verworfen. Ein Vanity-Host per CNAME **löst das
nicht** (eine Provider-Instanz = ein Issuer; Discovery, `iss` und die aus `config.issuer`
abgeleitete SIWE-`expectedDomain` hängen alle daran). Entschieden: **zweite Fly-App
`ortis-id` mit eigenem `ISSUER_URL=https://id.ortis.app`**, gleiches Image, nur der
Ortis-RP registriert. Dafür war ein Code-Blocker zu lösen — `NEXTCLOUD_*` war zwingend;
jetzt sind alle bekannten Prefixe optional und `loadConfig()` verlangt nur noch
**mindestens einen** RP (Commit `9cac3b09`). Vollständiges Runbook:
`apps/roebel-id/README.md` → „Running a second instance for another community".

**⚠️ Vor dem nächsten `fly deploy -a roebel-id`:** auf der laufenden Instanz stehen noch
`ORTIS_*`-Secrets mit dem wörtlich übernommenen Platzhalter
`https://app.ortis.<domain>/api/auth/callback`. Das ist keine gültige URI; seit `d9ce3651`
prüft `loadConfig()` das beim Boot, d.h. der nächste Deploy dieser App würde **nicht
starten**. Der Ortis-Client zieht ohnehin auf `ortis-id` um, also:
`fly secrets unset ORTIS_CLIENT_ID ORTIS_CLIENT_SECRET ORTIS_REDIRECT_URIS -a roebel-id`.

**Reihenfolge für den Live-Test (Domain = `ortis.app`, App live seit 2026-08-09):**
1. Vercel-Seite zuerst: `ORTIS_BASE_URL=https://app.ortis.app` setzen — die App baut ihre
   `redirect_uri` daraus und schickt sonst die generierte Vercel-Domain
   (`ortis-three.vercel.app`), was als Pilot-Adresse nicht besser ist als `roebel.app`.
2. `ortis-id` nach README-Runbook hochziehen (eigene `JWKS_JSON` + `COOKIE_KEYS`,
   `ORTIS_REDIRECT_URIS=https://app.ortis.app/api/auth/callback`, `fly deploy -c fly.ortis.toml`,
   `fly certs add id.ortis.app`).
3. Vercel: `OIDC_ISSUER=https://id.ortis.app`, `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`,
   `ORTIS_DEV_AUTH=0`.
4. `ORTIS_*` auf `roebel-id` unsetzen (siehe Warnung oben).

**Offen (nächste Session):** I2b (Keystone-eigener OTP-Versand — zusätzlich blockiert durch Max'
thirdweb-Dashboard-Task), I3 (QR-Pairing), I4 (`communities`-Claim), I5 (Manifest-Reife).
Für I4 vormerken: der OIDC-Scope heißt heute `roebel` und die Claims `roebel:*` — der
Ortis-Client muss also einen Scope „roebel" anfragen. Bewusst entscheiden, wenn `netizen:*` landet.

## 2. Arbeitspakete (Reihenfolge = Priorität)

### I1 — Ortis-Client + generische RP-Liste
Env-Block-Muster verallgemeinern (generische first-party-RP-Liste ODER `ORTIS_CLIENT_ID`-Block
nach Matrix-Vorbild); Redirect `https://app.ortis.<domain>/api/auth/callback` (+ lokale Dev-URI);
Env-Template für Fly dokumentieren. Bestehende RPs (Nextcloud/Matrix/Web) dürfen nicht brechen.

### I2 — Login-Branding pro Client (Pilot-Pflicht!)
`renderLoginPage` parametrisieren: der anfragende Client bestimmt das Branding — Ortis-Client →
**Ortis-Branding** („Anmelden bei Ortis", monochrom, optional Kontextzeile aus Org-Name),
Röbel-Clients → unverändert Röbel ID. Erweiterbar als `branding`-Config pro RP (deckt sich mit
dem zugesagten Custom-Login pro Community, ORTIS_KICKOFF §1b).

### I2b — Gebrandete Code-Mail: Keystone-eigener OTP + thirdweb Custom Auth (Max, 2026-08-09)

Die OTP-Mail darf nicht von thirdweb kommen. Der Flow wird umgedreht:
1. Login-Seite → **Keystone verschickt den Code selbst** (Node-SMTP/nodemailer, Absender +
   Template im Client-Branding aus I2 — „Ortis" für Ortis-Nutzer), verifiziert ihn, stellt die
   Session/ein signiertes Token aus (JWKS-Endpoint existiert bereits).
2. Wallet-Ableitung: `wallet.connect({ strategy: 'jwt' | 'auth_endpoint', … })` — thirdweb
   verifiziert UNSER Token (OIDC-JWT gegen unseren JWKS bzw. auth_endpoint) und liefert
   dasselbe deterministische Enclave-Smart-Account wie bisher. Dashboard-Konfiguration der
   Custom-Auth nötig (Max' Task: im thirdweb-Dashboard aktivieren; Plan-Verfügbarkeit prüfen).
3. `preAuthenticate` (thirdweb-Mail) fliegt aus der Login-Seite; Social-OAuth-Buttons bleiben
   vorerst unverändert.
Wichtig: gleiche User-ID-Zuordnung sicherstellen (bestehende E-Mail-Identitäten müssen dasselbe
Wallet ergeben — thirdweb Custom-Auth-User-ID-Semantik gegen die bisherigen E-Mail-Accounts
testen, BEVOR es live geht; sonst bekommen Bestandsnutzer neue Adressen).

### I3 — QR-App-Connect (Pairing-Grant, Demo-Spec Schritt 1)
Spec: `netizen/netizen_labs/docs/superpowers/specs/2026-08-09-buergermeister-demo-design.md` §1.
- Keystone: Pairing-Session (kurze TTL, one-shot), QR-Payload, **Verifikations-Code auf beiden
  Screens** (Phishing-Schutz), authentifizierter Approve-Endpoint, Web-Seite pollt/redirectet.
- Expo-App (dieses Repo, `apps/expo`): Deep Link + Scanner-Route + Bottom Sheet (wer fragt an,
  Code, ein „Verbinden"-Button) — approve als authentifizierter Call der eingeloggten Citizen-
  Session. Rate Limits, Audit-Log-Zeile pro Pairing.
- Exit-Test: QR auf app.ortis scannen → Röbel-App-Bottom-Sheet → Verbinden → Ortis-Session
  läuft als dieselbe Person.

### I4 — Multi-Community-Attestations: der `communities`-Claim (Max' Kernfrage)
Der Resolver beantwortet künftig: **zu welchen Communities gehört dieses Wallet — keine, eine,
mehrere?**
- Quelle: **CommunityRegistry** auf Gnosis (`0x1c4B243a5f72248aEFcd6F11caf0d3cFAe9fF889`,
  Manifest: `contracts/governor-contract/deployments/community-registry.json`) enumerieren; pro
  Eintrag die Membership-Kontrakte (`balanceOf(wallet)`) lesen.
- Claim-Form (neutraler Namespace, `roebel:*` bleibt für Kompatibilität):
  `netizen:communities = [{ id, chainId, membership: address, name, roles: ['citizen'|'attester'] }]`
  — leeres Array ist ein gültiges, normales Ergebnis.
- **Cache pro Wallet mit TTL** (Registry × N Kontrakte pro Login ist sonst zu teuer); Invalidierung
  grob ist okay (Membership ändert sich selten).
- **Vertrauensregel (wichtig):** Registry-Einträge sind self-sovereign → `name` ist UNGEPRÜFTER
  Text. Anzeige nur mit kuratierter Verified-Liste (Env/Config) oder als „unverifiziert"
  markiert. Und: der Claim ist **Identitätskontext, niemals Autorisierungswahrheit** — Ortis-
  Rollen (Vier-Augen!) kommen ausschließlich aus Ortis' eigenen `members`/`member_roles`-Tabellen
  (so hat es die Ortis-Session korrekt gebaut; nicht aufweichen).

### I5 — (danach) Manifest-Reife
Der Keystone als generischer Netizen-Identity-Service: Env-Schema dokumentieren, damit
`netizen render` ihn pro Community-Node ausrollen kann (Issuer pro Community = Phase 3,
NICHT in diesem Build — nur nichts tun, was es verbaut).

### Ausblick (NICHT dieser Build): das souveräne Enclave-Äquivalent
Verifizierte Zielarchitektur (Stack-Research 2026-07-22 §1 + Spec `2026-07-27-thirdweb-
independence.md`): Passkey/WebAuthn-PRF (Geräte-Enclave, deterministisch, kein Vendor) + Safe/
Kernel-Account + eigene 4337-Rails (Netizen Accounts; Gate C-1 Kernel-v3-Layer). Für Nutzer ohne
Passkey (Gerätefloor iOS 18+/Android 14+ bzw. reine E-Mail-Nutzer): **der Node als Verwahrer**
(envelope-verschlüsseltes Vault-Muster wie beim Ortis-Signer) statt US-Vendor. Migration ist
entspannt, weil Smart-Account-Adressen beim **Signer-Tausch stabil bleiben** — thirdweb-Key raus,
Passkey/Node-Key rein, Identität unverändert. Dieser Build tut nichts, was diesen Pfad verbaut
(I2b macht die Auth bereits vendor-eigen; nur die Schlüsselableitung bleibt vorerst thirdweb).

## 3. Regeln
- TDD — die bestehende Test-Suite (`test/`, u.a. e2e-flow mit Stub-Overrides über `wireApp`)
  ist das Muster; jedes Paket erweitert sie.
- SIWE-Statement bleibt ASCII; Verify bleibt `viem.verifyMessage` (6492 inklusive).
- Deploy = Fly (`fly.toml` vorhanden) — Deploy-Schritt für Max dokumentieren, nicht selbst
  ausführen ohne Freigabe.
- Keine Wallet-Adressen in UI-Anzeigen (Standing Rule); pseudonymer Handle bleibt.
- Stop-Punkte: nach I2 (Ortis-Login live testbar) und nach I4 (Claim-Review) Bericht an Max.
