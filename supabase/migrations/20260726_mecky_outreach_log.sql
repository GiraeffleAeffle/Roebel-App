-- Outbound runtime (Phase 3) — proactive Mecky outreach log + story opt-out.
-- mecky_outreach_log is the reusable dedupe/cap/audit backbone: one row per
-- (account, outreach type). Story outreach uses type='story_invite'; Fördermittel
-- outreach later uses type='foerder_match', etc.

CREATE TABLE IF NOT EXISTS public.mecky_outreach_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID REFERENCES public.accounts(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,            -- 'story_invite' | 'foerder_match' | ...
  recipient_wallet TEXT,
  result           TEXT NOT NULL DEFAULT 'sent',
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, type)                  -- one outreach of a given type per account, ever
);
CREATE INDEX IF NOT EXISTS idx_mecky_outreach_log_type ON public.mecky_outreach_log(type);
ALTER TABLE public.mecky_outreach_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mecky_outreach_log_all" ON public.mecky_outreach_log FOR ALL USING (true) WITH CHECK (true);

-- Opt-out for proactive story invites (default on for orgs; a Verein/business can turn it off).
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS story_outreach_opt_in BOOLEAN NOT NULL DEFAULT true;
