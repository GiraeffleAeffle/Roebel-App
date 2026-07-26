# Hetzner setup — a target box for the Netizen node

What to provision so `netizen up` (installer P2) can stand up the Röbel node from
`roebel.netizen.json`. Once this box exists and you give me its SSH target, I build +
test the executor against it. This is also exactly the box Röbel's own infra runs on.

## 1. The box

Hetzner Cloud, in the EU (Nuremberg or Falkenstein):

| | Recommended | Why |
|---|---|---|
| Type | **CPX41** (8 vCPU, 16 GB RAM) — CPX31 (4/8) works to start | Nextcloud + Matrix (Synapse+MAS+Postgres) + strfry + Caddy + keystone |
| OS | **Ubuntu 24.04** | Docker target the runbook assumes |
| Disk | add a **≥160 GB volume** | Nextcloud files + Synapse media + Postgres grow |
| Location | `nbg1` / `fsn1` | EU data residency (sovereignty) |

Cost: roughly €15–30/month. Create with an **SSH key** (not password).

## 2. On the box (one-time)

```bash
# as root (or a sudo user)
apt update && apt -y install docker.io docker-compose-plugin
systemctl enable --now docker
# a non-root deploy user the executor will use:
adduser --disabled-password --gecos "" netizen && usermod -aG docker,sudo netizen
mkdir -p /home/netizen/.ssh && cp ~/.ssh/authorized_keys /home/netizen/.ssh/ \
  && chown -R netizen:netizen /home/netizen/.ssh
```

## 3. DNS (point these A records at the box IP)

`id` · `cloud` · `matrix` · `auth` · `chat` · `relay` — all `.roebel.app` → the box's IPv4.
(Caddy in the bundle terminates TLS for each via Let's Encrypt.) Keep `www`/apex on Vercel.

## 4. Firewall / ports

Open **80** and **443** (Caddy). Everything else (7777 strfry, 8008 synapse, 8080 mas,
11000 nextcloud) stays internal — Caddy proxies them. Open **8448** only if you want
Matrix federation with other homeservers.

## 5. Secrets to have ready

These are the `SECRETS.md` references the executor resolves at apply time (never in the
repo/bundle). Have them in a `.env` on the box or a vault:

```
GNOSIS_RPC=...              GNOSIS_BUNDLER_RPC=...
ROEBEL_ID_JWKS=...          COORDINATOR_PUBKEY=...
THIRDWEB_CLIENT_ID=...      SUPABASE_URL=...
NEXTCLOUD_CLIENT_SECRET=... MATRIX_CLIENT_SECRET=...
POSTGRES_PASSWORD=...       (choose a strong one)
```

Also stand up **Nextcloud via Nextcloud AIO** (its own installer, port 8080 for first-run
config); Caddy proxies `cloud.roebel.app` → it.

## 6. Hand it to me

Give me: the **SSH target** (`netizen@<box-ip>`), confirmation the box is fresh, and
(optional) a **scoped Hetzner API token** if you want P3 to *create* the box + DNS
automatically next. I never store secrets — the executor reads the refs from the box's
env/vault at apply time. Then I build + test `netizen up` by provisioning the real Röbel
node, and Röbel becomes the proof that a node stands up from one manifest.
