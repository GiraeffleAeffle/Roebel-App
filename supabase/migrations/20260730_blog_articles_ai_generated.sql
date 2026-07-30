-- AI Act Art. 50(4): AI-generated texts informing the public must be
-- disclosed. Mecky co-writes stories, so the article row records that fact
-- at creation and the UI renders a visible "Mit KI erstellt" label from it.
--
-- Backfill: every article created through the Mecky story flow is linked from
-- mecky_conversations.draft_article_id, so existing AI-co-written stories are
-- stamped retroactively.

ALTER TABLE public.blog_articles
  ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false;

UPDATE public.blog_articles a
SET ai_generated = true
WHERE EXISTS (
  SELECT 1 FROM public.mecky_conversations c
  WHERE c.draft_article_id = a.id
);

COMMENT ON COLUMN public.blog_articles.ai_generated IS
  'True when the text was AI-(co-)written (Mecky story engine). Drives the Art. 50(4) disclosure label.';
