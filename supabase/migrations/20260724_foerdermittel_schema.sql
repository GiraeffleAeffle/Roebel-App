-- Fördermittel Agent — Plan 1 schema (funding catalog, org profile, matches, consent)

CREATE TABLE IF NOT EXISTS public.funding_programs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  provider          TEXT NOT NULL,
  level             TEXT NOT NULL DEFAULT 'sonstiges'
                      CHECK (level IN ('eu','bund','land','landkreis','lag','stiftung','kommune','sonstiges')),
  summary           TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  target_sub_types  TEXT[] NOT NULL DEFAULT '{}',
  sector_tags       TEXT[] NOT NULL DEFAULT '{}',
  eligibility       JSONB NOT NULL DEFAULT '{}'::jsonb,
  amount_min        NUMERIC,
  amount_max        NUMERIC,
  funding_rate      TEXT,
  deadline          DATE,
  deadline_type     TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (deadline_type IN ('fixed','rolling','annual','unknown')),
  source_url        TEXT NOT NULL,
  source_checked_at TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'proposed'
                      CHECK (status IN ('curated','proposed','verified','archived')),
  confidence        TEXT NOT NULL DEFAULT 'medium'
                      CHECK (confidence IN ('high','medium','low')),
  origin            TEXT NOT NULL DEFAULT 'curated'
                      CHECK (origin IN ('curated','research_agent')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_funding_programs_status ON public.funding_programs(status);
ALTER TABLE public.funding_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "funding_programs_select" ON public.funding_programs FOR SELECT USING (true);
CREATE POLICY "funding_programs_insert" ON public.funding_programs FOR INSERT WITH CHECK (true);
CREATE POLICY "funding_programs_update" ON public.funding_programs FOR UPDATE USING (true);
CREATE POLICY "funding_programs_delete" ON public.funding_programs FOR DELETE USING (true);

CREATE TABLE IF NOT EXISTS public.funding_program_sources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  UUID NOT NULL REFERENCES public.funding_programs(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  quote       TEXT NOT NULL DEFAULT '',
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_funding_program_sources_program ON public.funding_program_sources(program_id);
ALTER TABLE public.funding_program_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "funding_program_sources_all" ON public.funding_program_sources FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.org_funding_profiles (
  account_id           UUID PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  legal_form           TEXT NOT NULL DEFAULT 'unbekannt'
                         CHECK (legal_form IN ('ev','gmbh','ggmbh','gbr','ug','einzelunternehmen','sonstiges','unbekannt')),
  is_gemeinnuetzig     BOOLEAN,
  founded_year         INT,
  member_count         INT,
  budget_band          TEXT NOT NULL DEFAULT 'unbekannt'
                         CHECK (budget_band IN ('unter_5k','5k_25k','25k_100k','ueber_100k','unbekannt')),
  sector_tags          TEXT[] NOT NULL DEFAULT '{}',
  project_needs        TEXT NOT NULL DEFAULT '',
  goals                TEXT NOT NULL DEFAULT '',
  region               TEXT NOT NULL DEFAULT 'Röbel/Müritz',
  profile_completeness INT NOT NULL DEFAULT 0,
  last_interviewed_at  TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.org_funding_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_funding_profiles_all" ON public.org_funding_profiles FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.org_funding_matches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  program_id        UUID NOT NULL REFERENCES public.funding_programs(id) ON DELETE CASCADE,
  score             NUMERIC NOT NULL DEFAULT 0,
  probability_band  TEXT NOT NULL DEFAULT 'niedrig'
                      CHECK (probability_band IN ('hoch','mittel','niedrig')),
  rationale         TEXT NOT NULL DEFAULT '',
  requirements      TEXT NOT NULL DEFAULT '',
  red_flags         TEXT NOT NULL DEFAULT '',
  collapsed         BOOLEAN NOT NULL DEFAULT false,
  status            TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new','seen','saved','dismissed','applying')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, program_id)
);
CREATE INDEX IF NOT EXISTS idx_org_funding_matches_account ON public.org_funding_matches(account_id);
ALTER TABLE public.org_funding_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_funding_matches_all" ON public.org_funding_matches FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS foerder_outreach_opt_in BOOLEAN NOT NULL DEFAULT true;
