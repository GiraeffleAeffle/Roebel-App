# Nextcloud OIDC Setup for Röbel ID

## Prerequisites

1. Start the Nextcloud and Collabora services using the provided compose file:
   ```bash
   docker compose -f docker-compose.nextcloud.yml up -d
   ```

2. Ensure the Röbel ID dev server is running with a public tunnel (e.g., ngrok)

3. Add the tunnel URL to your environment:
   - Set `ISSUER_URL` to the tunnel URL in the Röbel ID app
   - Add the Nextcloud redirect URI to `NEXTCLOUD_REDIRECT_URIS` in the Röbel ID config

## Installation and Configuration

Run the following commands inside the Nextcloud container to install and configure the OIDC provider:

### Step 1: Install the user_oidc app

```bash
docker compose -f docker-compose.nextcloud.yml exec -u www-data nextcloud php occ app:install user_oidc
```

### Step 2: Configure the Röbel ID OIDC provider

```bash
docker compose -f docker-compose.nextcloud.yml exec -u www-data nextcloud php occ user_oidc:provider Roebel \
  --clientid="nextcloud" \
  --clientsecret="<NEXTCLOUD_CLIENT_SECRET>" \
  --discoveryuri="https://id.roebel.app/.well-known/openid-configuration" \
  --scope="openid email profile roebel" \
  --unique-uid=1 \
  --mapping-uid=sub \
  --mapping-email=email \
  --mapping-display-name=name \
  --mapping-groups=groups
```

**Note:** For local development, replace `https://id.roebel.app/.well-known/openid-configuration` with the ngrok tunnel URL pointing to your dev server (e.g., `https://xxxxx.ngrok.io/.well-known/openid-configuration`).

Replace `<NEXTCLOUD_CLIENT_SECRET>` with the actual client secret configured for Nextcloud in the Röbel ID provider settings.

### Step 3: Enable group provisioning from the token

```bash
docker compose -f docker-compose.nextcloud.yml exec -u www-data nextcloud php occ config:app:set user_oidc provisioning_groups --value=1
```

## Verification

After running these commands, verify the configuration:

1. Open http://localhost:8080 in your browser
2. You should see a "Login with Roebel" button on the login page
3. Click it to test the OIDC flow

## Nextcloud Access

- Admin URL: http://localhost:8080/
- Default credentials (initial setup):
  - Username: `admin`
  - Password: `admin`

## Collabora CODE Integration

Collabora CODE is accessible at: http://localhost:9980

It is automatically configured to work with Nextcloud for document editing.

## Troubleshooting

- Check the Nextcloud logs: `docker compose -f docker-compose.nextcloud.yml logs nextcloud`
- Check the Collabora logs: `docker compose -f docker-compose.nextcloud.yml logs collabora`
- Verify the discovery endpoint is accessible from the container: `docker compose -f docker-compose.nextcloud.yml exec nextcloud curl https://id.roebel.app/.well-known/openid-configuration`
