-- Münzen Tips (Local News Phase 2) — reader→author appreciation audit/tally.
-- On-chain (Circles Hub transfer) is the source of truth; this table is a
-- best-effort record enabling the "❤️ N Münzen" tally + audit, and generalizes
-- to any tippable content via (context_type, context_id).

CREATE TABLE IF NOT EXISTS public.muenzen_tips (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_wallet   TEXT NOT NULL,                 -- lowercased sender
  to_wallet     TEXT NOT NULL,                 -- lowercased recipient (author)
  amount_atto   NUMERIC NOT NULL,              -- Röbel Münzen in atto (18 dp)
  context_type  TEXT NOT NULL DEFAULT 'blog_article',
  context_id    TEXT NOT NULL,
  tx_hash       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_muenzen_tips_context ON public.muenzen_tips(context_type, context_id);
CREATE INDEX IF NOT EXISTS idx_muenzen_tips_to ON public.muenzen_tips(to_wallet);
ALTER TABLE public.muenzen_tips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "muenzen_tips_all" ON public.muenzen_tips FOR ALL USING (true) WITH CHECK (true);
