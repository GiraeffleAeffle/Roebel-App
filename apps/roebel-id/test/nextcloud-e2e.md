# Nextcloud OIDC Integration — End-to-End Checklist

This document encodes the spec's success criteria as an executable E2E checklist. Follow these steps to verify the complete Nextcloud + Röbel ID OIDC integration.

## Prerequisites

- Röbel ID dev server running locally
- Public tunnel (ngrok) pointing to the Röbel ID server
- Docker and docker-compose installed
- Network connectivity to the Gnosis chain (for wallet verification)

## E2E Test Steps

### Step 1: Prepare the IdP and Configuration

- [ ] Start the Röbel ID dev server (if not already running)
- [ ] Set up a public tunnel to the dev server using ngrok: `ngrok http 3000` (adjust port as needed)
- [ ] Note the tunnel URL (e.g., `https://xxxxx.ngrok.io`)
- [ ] Update environment variables in the Röbel ID app:
  - [ ] Set `ISSUER_URL` to the ngrok tunnel URL
  - [ ] Add Nextcloud redirect URI to `NEXTCLOUD_REDIRECT_URIS`: `http://localhost:8080/apps/user_oidc/code`
- [ ] Verify the discovery endpoint is accessible: `curl https://xxxxx.ngrok.io/.well-known/openid-configuration`

### Step 2: Start Nextcloud and Configure OIDC

- [ ] Start Nextcloud and Collabora:
  ```bash
  docker compose -f docker-compose.nextcloud.yml up -d
  ```
- [ ] Wait for Nextcloud to be fully initialized (check logs: `docker compose -f docker-compose.nextcloud.yml logs -f nextcloud`)
- [ ] Run the OIDC configuration commands (from `docs/nextcloud-setup.md`):
  - [ ] Install user_oidc app
  - [ ] Configure the Röbel ID provider (using ngrok URL in discoveryuri)
  - [ ] Enable group provisioning
- [ ] Verify configuration: `docker compose -f docker-compose.nextcloud.yml exec -u www-data nextcloud php occ config:app:get user_oidc`

### Step 3: Verify Login Page

- [ ] Open http://localhost:8080 in a web browser
- [ ] Confirm that a "Login with Roebel" button is visible on the login page
- [ ] **PASS**: Button is present and visible

### Step 4: Test OIDC Authentication Flow

- [ ] Click the "Login with Roebel" button
- [ ] Verify redirect to Röbel ID login page (URL should match the ngrok tunnel)
- [ ] Click "Mit Röbel anmelden" (or equivalent login button)
- [ ] Verify thirdweb Connect modal appears
- [ ] **ACTION**: Enter email or use existing wallet
- [ ] Verify smart account connection
- [ ] Verify SIWE (Sign In With Ethereum) signature prompt appears
- [ ] **ACTION**: Sign the SIWE message in your wallet
- [ ] Verify redirect back to Nextcloud after successful signature
- [ ] **PASS**: OIDC flow completes without errors

### Step 5: Verify User Auto-Provisioning

- [ ] Wait for redirect to Nextcloud dashboard (may take 10-30 seconds)
- [ ] Confirm you are logged into Nextcloud
- [ ] Navigate to Nextcloud admin panel: http://localhost:8080/index.php/settings/users
- [ ] **VERIFY**: A new user account exists, keyed on `sub` (lowercased wallet address)
- [ ] **VERIFY**: User email field is populated with the email from the ID token
- [ ] **VERIFY**: User display name is populated from the `name` claim
- [ ] **PASS**: User account was automatically created with correct attributes

### Step 6: Verify Group Mapping

- [ ] In the Nextcloud admin panel, navigate to Users
- [ ] Click on the newly created user to view their group memberships
- [ ] **VERIFY**: The user belongs to expected groups:
  - [ ] Group `citizen` present if the user holds CitizenNFTv2
  - [ ] Groups matching `org:<org-id>:<role>` for organizations the user is part of (from `account_owners` table)
  - [ ] Groups reflect the claims from the Röbel ID `groups` claim in the ID token
- [ ] **PASS**: Group membership matches token claims and on-chain state

### Step 7: Verify Collabora Document Editing

- [ ] In Nextcloud dashboard, navigate to Files
- [ ] Create a new file or open an existing document (if one exists)
- [ ] Open the document in Nextcloud Office (Collabora)
- [ ] **VERIFY**: The Collabora editor loads at http://localhost:9980
- [ ] **ACTION**: Make a test edit (e.g., type a few words)
- [ ] **VERIFY**: Document saves automatically
- [ ] **VERIFY**: Refresh the page and confirm the edit persists
- [ ] **PASS**: Document editing and persistence works

## Success Criteria

**PASS** = All steps 3–7 succeed without errors:
- ✓ Login redirects work (step 3)
- ✓ OIDC authentication flow completes (step 4)
- ✓ User auto-provisioned with correct attributes (step 5)
- ✓ Group mapping reflects token + on-chain state (step 6)
- ✓ Collabora document editing works (step 7)

This is the **keystone proof** that the Röbel ID OIDC provider fully integrates with Nextcloud as specified in the architecture document.

## Failure Diagnosis

If any step fails, check:

1. **Login redirect fails**: Verify `NEXTCLOUD_REDIRECT_URIS` includes the exact URI and ISSUER_URL is set correctly
2. **SIWE signature hangs**: Check that the smart account is properly initialized; verify Gnosis chain RPC is accessible
3. **User not auto-provisioned**: Check Nextcloud logs for OIDC claim mapping errors; verify the `--mapping-uid=sub` option is set
4. **Groups missing**: Verify `provisioning_groups=1` is set; check that the Röbel ID token includes a `groups` claim with the correct structure
5. **Collabora doesn't load**: Verify Collabora container is running (`docker compose -f docker-compose.nextcloud.yml logs collabora`); check network connectivity between Nextcloud and Collabora

## Cleanup

To stop and remove the Nextcloud environment:

```bash
docker compose -f docker-compose.nextcloud.yml down -v
```

(The `-v` flag removes the data volume.)
