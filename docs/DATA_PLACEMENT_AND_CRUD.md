# What data lives where, and how you edit or delete it

**Date: 2026-07-28.** Part of the [documentation index](README.md). Companions:
[State of Nostr](STATE_OF_NOSTR.md), [Stadtstack alignment](STADTSTACK_ALIGNMENT.md).

Answers the recurring questions: is the protocol or the database faster, can anything be
deleted, and where should events, cinema listings, organisations and marketplace entries
actually live.

---

## 1. The rule

**The protocol is the source of truth. A database is a derived index. Every node keeps its
own.**

That single sentence decides most of what follows. It is already how the node is built: the
index re-verifies every signature on ingest, keys rows by the event hash, and is fully
rebuildable by re-reading the relays. Delete the database and nothing is lost — which is
exactly what stops query convenience from turning into lock-in.

## 2. Is Nostr faster than Supabase? No — and it should not be

A relay is not a database. NIP-01 filters give you `ids`, `authors`, `kinds`, tag matches and a
time range. That covers a chronological feed and nothing else. There are no joins, no
aggregation, no full-text search, no secondary indexes, no "posts by people I follow in my
district sorted by engagement".

So the split is not a compromise, it is the correct architecture:

| | Reads from | Why |
|---|---|---|
| The app | an index (Supabase today) | joins, filters, counts, pagination — fast |
| Agents and peers | the relay, or the node's index API | signed, verifiable, portable |
| Anyone else | the relay | no permission needed, nothing to shut down |

**What matters is not which store is fastest, but which one is authoritative.** Today Supabase
holds both roles for app data, which is the dependency worth removing — not by making the app
read the relay directly, but by making the index the read path and the protocol the truth. The
node already runs such an index at `https://index.roebel.app`.

## 3. Can you delete something on Nostr?

**Not reliably, and you must design as if you cannot.**

NIP-09 defines a kind 5 *deletion request*. Relays **may** honour it. Röbel's relay declares
NIP-09 support in its NIP-11 document, so a request against it should take effect there. But:

- a peer's relay that mirrored the event may ignore it,
- any client that already fetched the event keeps its copy,
- and a federated mirror is a separate store with its own policy.

So deletion is **best-effort erasure plus a durable local decision**. Two mechanisms, used
together:

### Edit — use replaceable events, not deletion

NIP-01 makes kinds `30000`–`39999` *parameterised replaceable*: a newer event with the same
author and the same `d` tag **replaces** the older one at the relay. This is real edit
semantics, and it is what anything mutable should use from the start.

The wallet↔npub binding already works this way (kind 30078 with `d = netizen:binding:v1`), so
re-binding overwrites rather than accumulating.

Editing a plain kind 1 note is not possible. If a content type may ever be edited, it must not
be a kind 1.

### Delete — request erasure *and* record the intent

1. Publish a kind 5 deletion request. On Röbel's own relay this should remove it.
2. **Record the deletion in the index**, so every surface the community controls honours it
   whether or not a foreign relay complied. This is the "hide state" — and it must live in the
   index, not only in the app, or a second client will keep showing the content.

The app already tells users the truth about this: the Nostr settings screen states plainly that
published events are public and that erasure can be requested but not forced. **That honesty is
the feature.** A UI that implies deletion is guaranteed is making a promise the protocol cannot
keep, and for a municipality that is a GDPR exposure rather than a UX detail.

### The consequence for what gets published

Because erasure is advisory, **only data that may remain public forever goes on the relay.**
Anything erasable stays in the node's own systems. That is not a limitation to work around; it
is the boundary that makes the rest safe.

## 4. Where should events, cinema, organisations and marketplace live?

### The test

Publish to the protocol when **all** of these hold:

1. It is already public.
2. Someone outside the app benefits from reading it — a peer node, an agent, another client.
3. It may remain public permanently.
4. It has an author who can sign it.

Keep it in the node's own store when any of these hold: it contains personal data, it must be
erasable, it is a draft, or it is transactional state (payments, stock, private messages).

### Applied

| Data | Where | Why |
|---|---|---|
| **Events / Veranstaltungen** | Protocol | Public, dated, and the single most useful thing for a neighbouring town's agent to read. NIP-52 defines calendar event kinds, so a standard client can render Röbel's calendar with no integration |
| **Cinema programme** | Protocol | Public listings, same shape as events. Authored by the cinema's own identity |
| **Organisations** | Protocol | An organisation is an identity: a kind 0 profile, signed by the org, portable between nodes |
| **Marketplace listings** | Protocol, as replaceable events | Public offers that change (price, availability), so parameterised replaceable kinds. NIP-15 defines a marketplace shape. **The listing is public; the transaction is not** |
| **Payments, orders, messages** | Node only | Transactional and personal. Never on an append-only public log |
| **Citizen PII, evidence, drafts** | Node only | Must be erasable |
| **Votes** | Neither | MACI, encrypted. Only the aggregate tally is public |

**Prefer a standard NIP over a custom kind wherever one exists.** A custom kind means only
Röbel's app can render the data; a standard kind means the whole Nostr ecosystem can. That is
the difference between publishing data and publishing data *usefully*. Verify the exact kind
numbers against the current NIP text before implementing — they are easy to get subtly wrong.

## 5. One database for everyone, or one per node?

**One per node. This is not a close call.**

A single shared database is a single point of failure, a single point of control, and a single
subpoena target. It reintroduces exactly what the stack exists to remove — and it would mean
Röbel's ability to query its own record depends on someone else keeping a server running.

Per-node indexing gives:

- **Nothing to shut down.** Kill any node and the others keep their index *and* the protocol
  data. Kill all the indexes and every one of them can be rebuilt by re-reading the relays.
- **Each node decides what it ingests.** Röbel indexes its own record and its declared peers',
  not the whole world.
- **Provenance stays intact.** Every row records which node it came from, so a federated answer
  is attributable rather than an undifferentiated pool.

This is already how it works. The cost is duplication — every node stores its peers' public
events — and that is the price of not having a centre. For public civic text it is a rounding
error.

## 6. So what does "build the civic data contract" mean?

Concretely, three things:

1. **Define the objects as versioned schemas** — `civic_topic_v1`, `civic_proposal_v1`,
   `evidence_return_v1`, `decision_dossier_v1` and the rest — in `packages/protocol`, next to
   the node manifest. Each carries schema version, jurisdiction, canonical ID, producer,
   checksum, provenance, visibility class, review status, **authority binding**, and a
   correction reference.

2. **Map each to a Nostr event kind and tag convention**, so the same object is a signed,
   federated, verifiable event rather than a JSON blob behind an API. Parameterised replaceable
   kinds for anything that gets corrected, with the canonical ID in the `d` tag — then a
   correction is a re-publish rather than a delete, which sidesteps §3 entirely.

3. **Freeze the canonical ID first.** Every other object references it and it ends up embedded
   in every published event. It is the one decision that is genuinely expensive to reverse.

The point of a *contract* is that neither side has to adopt the other's internal model. Röbel
keeps its schema, Stadtstack keeps its pipeline, and the boundary objects are few, versioned,
and signed.
