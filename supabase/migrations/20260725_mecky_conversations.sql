-- Persistent, multi-thread Mecky conversations (Backbone A)

CREATE TABLE IF NOT EXISTS public.mecky_conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_wallet     TEXT NOT NULL,                       -- lowercased thirdweb address
  account_id       UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  title            TEXT NOT NULL DEFAULT 'Neuer Chat',
  kind             TEXT NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat','story')),
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  draft_article_id UUID,                                -- set by Plan B (story threads)
  last_message_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mecky_conversations_owner
  ON public.mecky_conversations(owner_wallet, status, last_message_at DESC);
ALTER TABLE public.mecky_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mecky_conversations_all" ON public.mecky_conversations FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.mecky_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES public.mecky_conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content          TEXT NOT NULL DEFAULT '',
  rich_cards       JSONB,                                -- one RichCardData object or null
  nav_links        JSONB,                                -- NavigationLink[] or null
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mecky_messages_conversation
  ON public.mecky_messages(conversation_id, created_at);
ALTER TABLE public.mecky_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mecky_messages_all" ON public.mecky_messages FOR ALL USING (true) WITH CHECK (true);
