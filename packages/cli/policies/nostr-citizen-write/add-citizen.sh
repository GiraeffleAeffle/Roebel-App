#!/bin/sh
# Usage: add-citizen.sh <64-hex-nostr-pubkey>   (grant a Citizen write access)
pk="$1"
echo "$pk" | grep -qiE '^[0-9a-f]{64}$' || { echo "not a 64-hex nostr pubkey: $pk" >&2; exit 1; }
f=/root/strfry-policy/citizens.txt
grep -qi "^${pk}$" "$f" 2>/dev/null || printf '%s\n' "$pk" >> "$f"
echo "granted write: $pk"
