-- Flyer-Generator: saved A4 flyers an org generated with Mecky (gpt-image-1).
-- RLS-on with an open policy + app-layer owner enforcement (repo convention:
-- the thirdweb wallet has no Supabase auth session, so the server actions gate
-- via account_owners and use the admin client).

CREATE TABLE IF NOT EXISTS public.flyers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_by_wallet TEXT,
  title             TEXT NOT NULL DEFAULT '',
  brief             TEXT NOT NULL DEFAULT '',
  copy              JSONB NOT NULL DEFAULT '{}'::jsonb,
  style             TEXT NOT NULL DEFAULT 'modern',
  image_url         TEXT NOT NULL,
  event_id          UUID REFERENCES public.events(id) ON DELETE SET NULL,
  source            TEXT NOT NULL DEFAULT 'brief',   -- 'brief' | 'event'
  status            TEXT NOT NULL DEFAULT 'saved',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flyers_account_created ON public.flyers(account_id, created_at DESC);

ALTER TABLE public.flyers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "flyers_all" ON public.flyers FOR ALL USING (true) WITH CHECK (true);
