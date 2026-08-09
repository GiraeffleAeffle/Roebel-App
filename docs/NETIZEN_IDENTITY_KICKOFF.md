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

## 3. Regeln
- TDD — die bestehende Test-Suite (`test/`, u.a. e2e-flow mit Stub-Overrides über `wireApp`)
  ist das Muster; jedes Paket erweitert sie.
- SIWE-Statement bleibt ASCII; Verify bleibt `viem.verifyMessage` (6492 inklusive).
- Deploy = Fly (`fly.toml` vorhanden) — Deploy-Schritt für Max dokumentieren, nicht selbst
  ausführen ohne Freigabe.
- Keine Wallet-Adressen in UI-Anzeigen (Standing Rule); pseudonymer Handle bleibt.
- Stop-Punkte: nach I2 (Ortis-Login live testbar) und nach I4 (Claim-Review) Bericht an Max.
