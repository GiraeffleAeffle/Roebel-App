-- Fördermittel Agent — curated core (real programs, conservative structural data, human-verify before relying on exact figures)

INSERT INTO public.funding_programs
  (name, provider, level, summary, target_sub_types, sector_tags, eligibility, deadline_type, source_url, status, confidence, origin)
VALUES
  ('DSEE-Förderprogramme', 'Deutsche Stiftung für Engagement und Ehrenamt', 'bund',
   'Förderung für gemeinnützige Vereine und Engagement-Organisationen (Strukturstärkung, Digitalisierung, Qualifizierung).',
   ARRAY['verein'], ARRAY['ehrenamt','digitalisierung','engagement'],
   '{"legal_forms_allowed":["ev","ggmbh"],"gemeinnuetzig_required":true,"min_members":null,"max_members":null,"region_scope":["bundesweit"],"project_types":["strukturstaerkung","digitalisierung","qualifizierung"],"cofinancing_required":false,"min_years_established":null}'::jsonb,
   'rolling', 'https://www.deutsche-stiftung-engagement-und-ehrenamt.de/foerderung/', 'verified', 'medium', 'curated'),

  ('Aktion Mensch Förderung', 'Aktion Mensch e.V.', 'stiftung',
   'Förderung sozialer Projekte und Inklusion durch gemeinnützige Organisationen.',
   ARRAY['verein'], ARRAY['soziales','inklusion','teilhabe'],
   '{"legal_forms_allowed":["ev","ggmbh"],"gemeinnuetzig_required":true,"min_members":null,"max_members":null,"region_scope":["bundesweit"],"project_types":["inklusion","soziales"],"cofinancing_required":false,"min_years_established":null}'::jsonb,
   'rolling', 'https://www.aktion-mensch.de/foerderung', 'verified', 'medium', 'curated'),

  ('LEADER – LAG Mecklenburgische Seenplatte – Müritz', 'LEADER / LAG Mecklenburgische Seenplatte', 'lag',
   'Regionale EU-Förderung (ELER) für Projekte der ländlichen Entwicklung in der Mecklenburgischen Seenplatte.',
   ARRAY['verein','unternehmen','stadt'], ARRAY['laendliche_entwicklung','regional','tourismus'],
   '{"legal_forms_allowed":[],"gemeinnuetzig_required":false,"min_members":null,"max_members":null,"region_scope":["Landkreis MSE","Mecklenburgische Seenplatte"],"project_types":["laendliche_entwicklung"],"cofinancing_required":true,"min_years_established":null}'::jsonb,
   'unknown', 'https://www.leader-mse.de/', 'verified', 'low', 'curated'),

  ('Ehrenamtsstiftung MV – Förderungen', 'Ehrenamtsstiftung Mecklenburg-Vorpommern', 'land',
   'Landesförderung für ehrenamtliches Engagement und Vereine in Mecklenburg-Vorpommern.',
   ARRAY['verein'], ARRAY['ehrenamt','engagement'],
   '{"legal_forms_allowed":["ev"],"gemeinnuetzig_required":true,"min_members":null,"max_members":null,"region_scope":["MV","Mecklenburg-Vorpommern"],"project_types":["ehrenamt"],"cofinancing_required":false,"min_years_established":null}'::jsonb,
   'rolling', 'https://www.ehrenamtsstiftung-mv.de/', 'verified', 'medium', 'curated'),

  ('Demokratie leben!', 'Bundesministerium für Familie, Senioren, Frauen und Jugend (BMFSFJ)', 'bund',
   'Bundesprogramm zur Förderung von Demokratie, Vielfalt und gegen Extremismus.',
   ARRAY['verein','stadt'], ARRAY['demokratie','vielfalt','jugend','integration'],
   '{"legal_forms_allowed":[],"gemeinnuetzig_required":true,"min_members":null,"max_members":null,"region_scope":["bundesweit"],"project_types":["demokratie","integration"],"cofinancing_required":false,"min_years_established":null}'::jsonb,
   'unknown', 'https://www.demokratie-leben.de/', 'verified', 'low', 'curated'),

  ('Förderung durch die Sparkassenstiftung', 'Sparkassenstiftung (regional)', 'stiftung',
   'Regionale Stiftungsförderung für Kultur, Sport und Soziales durch Vereine und Initiativen.',
   ARRAY['verein'], ARRAY['kultur','sport','soziales'],
   '{"legal_forms_allowed":["ev"],"gemeinnuetzig_required":true,"min_members":null,"max_members":null,"region_scope":["MV","Landkreis MSE"],"project_types":["kultur","sport","soziales"],"cofinancing_required":false,"min_years_established":null}'::jsonb,
   'unknown', 'https://www.sparkasse.de/', 'verified', 'low', 'curated');

-- One representative citation per program for grounding (the human curator adds exact quotes on verification).
INSERT INTO public.funding_program_sources (program_id, url, quote)
SELECT id, source_url, '' FROM public.funding_programs WHERE origin = 'curated';
