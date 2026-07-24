-- =============================================================================
-- seed-staging.sql  —  STAGING ONLY. NEVER run against production.
-- =============================================================================
-- Loads a small amount of throwaway test data so the shared `roebel-staging`
-- backend isn't empty for contributors. Contains NO PII and NO real user data.
--
-- Safety properties:
--   * ARMED GUARD — this script REFUSES to run unless the DB has been explicitly
--     marked as staging (app_settings.roebel_env = 'staging'). Running it against
--     any un-marked DB (e.g. production) raises an exception and changes nothing.
--   * IDEMPOTENT — safe to re-run; uses fixed keys / ids + ON CONFLICT.
--   * EXISTENCE-GUARDED — skips any table that doesn't exist in this DB, so a
--     schema mismatch can't error the whole script.
--   * NON-DESTRUCTIVE — only inserts sample rows; never updates/deletes real data.
--
-- Usage (see docs/STAGING_ENVIRONMENT.md):
--   STEP 0 — arm this DB as staging (run ONCE, manually, against staging only):
--       insert into app_settings (key, value) values ('roebel_env', 'staging')
--       on conflict (key) do update set value = 'staging', updated_at = now();
--   STEP 1 — run this file against the staging project.
-- =============================================================================

DO $$
DECLARE
  v_env text;
BEGIN
  -- ---- Guard: only proceed on an explicitly-armed staging DB --------------
  IF to_regclass('public.app_settings') IS NULL THEN
    RAISE NOTICE 'app_settings table missing — apply migrations before seeding. Skipping.';
    RETURN;
  END IF;

  SELECT value INTO v_env FROM public.app_settings WHERE key = 'roebel_env';
  IF v_env IS DISTINCT FROM 'staging' THEN
    RAISE EXCEPTION
      'Refusing to seed: app_settings.roebel_env = %, expected ''staging''. Arm the DB first (STEP 0 in the header). This guard protects production.',
      COALESCE(quote_literal(v_env), '<unset>');
  END IF;

  RAISE NOTICE 'Staging DB confirmed (roebel_env = staging). Seeding sample data...';

  -- ---- 1. Welcome announcement (visible in-app so staging looks alive) ----
  IF to_regclass('public.announcements') IS NOT NULL THEN
    INSERT INTO public.announcements (id, title, description, cta_label, is_active, priority, show_once)
    VALUES (
      'aaaaaaaa-0000-4000-8000-000000000001',
      'Willkommen in der Staging-Umgebung',
      'Dies ist die Test-/Staging-Instanz der Röbel App. Alle Daten hier sind Testdaten und können jederzeit zurückgesetzt werden.',
      'Alles klar',
      true,
      100,
      false
    )
    ON CONFLICT (id) DO NOTHING;
    RAISE NOTICE '  + announcements: welcome row ensured';
  ELSE
    RAISE NOTICE '  - announcements table absent, skipped';
  END IF;

  -- ---- 2. Helpful staging flags (unknown keys are ignored by the app) -----
  INSERT INTO public.app_settings (key, value) VALUES
    ('staging_banner_text', 'STAGING — Testumgebung, keine echten Daten')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RAISE NOTICE '  + app_settings: staging_banner_text ensured';

END$$;

-- =============================================================================
-- DUMMY CONTENT — fabricated, NO real PII (makes staging feel "alive").
-- Armed (roebel_env='staging') + idempotent (fixed UUIDs + ON CONFLICT DO NOTHING).
-- USER triggers on users/posts/events/restaurants are suppressed during the seed
-- so the main-feed push trigger (Vault-dependent, absent on staging) can't error;
-- FK triggers stay on. Enum-ish values (tier, poi.type, *.status) were verified
-- against prod. NEVER put real users/posts/messages here — see docs/FORKING_GUIDE.md.
-- =============================================================================
DO $$
DECLARE v_env text;
BEGIN
  SELECT value INTO v_env FROM public.app_settings WHERE key='roebel_env';
  IF v_env IS DISTINCT FROM 'staging' THEN
    RAISE EXCEPTION 'Refusing to seed dummy data: roebel_env=% (expected staging)', COALESCE(v_env,'<unset>');
  END IF;

  ALTER TABLE public.users       DISABLE TRIGGER USER;
  ALTER TABLE public.posts       DISABLE TRIGGER USER;
  ALTER TABLE public.events      DISABLE TRIGGER USER;
  ALTER TABLE public.restaurants DISABLE TRIGGER USER;

  -- Fabricated test users (fake wallets, no real PII)
  INSERT INTO public.users (id, wallet_address, username, display_name, bio, neighborhood, tier, is_extern) VALUES
    ('dada0001-0000-4000-8000-000000000001','0xda7a000000000000000000000000000000000001','anke_b','Anke Böttcher','Seit 40 Jahren in Röbel. Liebe den Wochenmarkt.','Altstadt','citizen', false),
    ('dada0002-0000-4000-8000-000000000002','0xda7a000000000000000000000000000000000002','jonas_m','Jonas Malchin','Angler & Segler auf der Müritz.','Hafen','tourist', false),
    ('dada0003-0000-4000-8000-000000000003','0xda7a000000000000000000000000000000000003','kulturverein','Kulturverein Röbel','Wir organisieren Konzerte & Lesungen.','Marktplatz','citizen', false),
    ('dada0004-0000-4000-8000-000000000004','0xda7a000000000000000000000000000000000004','grit_w','Grit Wendt','Bäckerei-Fan und Hobbyfotografin.','Neustadt','tourist', false)
  ON CONFLICT DO NOTHING;

  -- Feed posts (main feed, published)
  INSERT INTO public.posts (id, wallet_address, content, feed_type, status, post_type, likes_count, comments_count, views_count, created_at) VALUES
    ('b0570001-0000-4000-8000-000000000001','0xda7a000000000000000000000000000000000001','Wunderschöner Sonnenaufgang heute früh über der Müritz. 🌅 Röbel von seiner besten Seite!','main','published','user',18,4,312, now() - interval '2 hours'),
    ('b0570002-0000-4000-8000-000000000002','0xda7a000000000000000000000000000000000002','Frischer Fang! Zander vom frühen Morgen. Wer Tipps für die besten Stellen will – meldet euch. 🎣','main','published','user',27,9,540, now() - interval '7 hours'),
    ('b0570003-0000-4000-8000-000000000003','0xda7a000000000000000000000000000000000003','Am Samstag: Sommerkonzert in der Kirche St. Marien, 19 Uhr. Eintritt frei, Spenden willkommen. 🎶','main','published','user',41,12,880, now() - interval '1 day'),
    ('b0570004-0000-4000-8000-000000000004','0xda7a000000000000000000000000000000000001','Der neue Radweg Richtung Bollewick ist endlich fertig – super gemacht! 🚲','main','published','user',33,6,610, now() - interval '2 days'),
    ('b0570005-0000-4000-8000-000000000005','0xda7a000000000000000000000000000000000004','Kleiner Gruß aus der Bäckerei am Markt – die Streuselschnecken sind wieder da. 😋','main','published','user',22,5,430, now() - interval '3 days'),
    ('b0570006-0000-4000-8000-000000000006','0xda7a000000000000000000000000000000000002','Müritz-Sonnenuntergang gestern. Ich werde nie müde davon. ❤️','main','published','user',55,14,1220, now() - interval '5 days')
  ON CONFLICT DO NOTHING;

  -- Events (upcoming, relative to run time) + dates
  INSERT INTO public.events (id, title, description, date, "time", location, organizer_name, organizer_email, category, latitude, longitude) VALUES
    ('e0e70001-0000-4000-8000-000000000001','Sommerkonzert St. Marien','Klassik & Chormusik in der Röbeler Stadtkirche. Eintritt frei.', CURRENT_DATE + 5, '19:00','Kirche St. Marien, Röbel','Kulturverein Röbel','info@example-roebel.test','Musik',53.3766,12.6081),
    ('e0e70002-0000-4000-8000-000000000002','Fischerfest am Hafen','Regionale Spezialitäten, Livemusik und Boote am Stadthafen.', CURRENT_DATE + 12, '11:00','Stadthafen Röbel','Hafenverein','hafen@example-roebel.test','Essen & Trinken',53.3739,12.6112),
    ('e0e70003-0000-4000-8000-000000000003','Müritz-Lauf','5-km- und 10-km-Volkslauf rund um die Altstadt.', CURRENT_DATE + 20, '10:00','Marktplatz Röbel','SV Röbel','sport@example-roebel.test','Sport',53.3758,12.6094)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.event_dates (id, event_id, date) VALUES
    ('da7e0001-0000-4000-8000-000000000001','e0e70001-0000-4000-8000-000000000001', CURRENT_DATE + 5),
    ('da7e0002-0000-4000-8000-000000000002','e0e70002-0000-4000-8000-000000000002', CURRENT_DATE + 12),
    ('da7e0003-0000-4000-8000-000000000003','e0e70003-0000-4000-8000-000000000003', CURRENT_DATE + 20)
  ON CONFLICT DO NOTHING;

  -- Restaurant + menu
  INSERT INTO public.restaurants (id, name, slug, description, address, phone, status, latitude, longitude) VALUES
    ('c0570001-0000-4000-8000-000000000001','Müritz Stuben','mueritz-stuben-staging','Regionale Küche mit Blick auf den See.','Seestraße 1, 17207 Röbel','039931 00000','published',53.3752,12.6103)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.menu_categories (id, restaurant_id, name) VALUES
    ('ca700001-0000-4000-8000-000000000001','c0570001-0000-4000-8000-000000000001','Vorspeisen'),
    ('ca700002-0000-4000-8000-000000000002','c0570001-0000-4000-8000-000000000001','Hauptgerichte'),
    ('ca700003-0000-4000-8000-000000000003','c0570001-0000-4000-8000-000000000001','Nachspeisen')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.menu_items (id, restaurant_id, category_id, name, description, price) VALUES
    ('a11e0001-0000-4000-8000-000000000001','c0570001-0000-4000-8000-000000000001','ca700001-0000-4000-8000-000000000001','Fischsuppe','Müritzer Art, mit frischem Zander',7.50),
    ('a11e0002-0000-4000-8000-000000000002','c0570001-0000-4000-8000-000000000001','ca700002-0000-4000-8000-000000000002','Gebratener Zander','mit Petersilienkartoffeln & Salat',18.90),
    ('a11e0003-0000-4000-8000-000000000003','c0570001-0000-4000-8000-000000000001','ca700002-0000-4000-8000-000000000002','Wildbratwurst','vom Müritz-Wild, mit Rösti',14.50),
    ('a11e0004-0000-4000-8000-000000000004','c0570001-0000-4000-8000-000000000001','ca700003-0000-4000-8000-000000000003','Sanddorn-Quark','regionaler Sanddorn, hausgemacht',5.90)
  ON CONFLICT DO NOTHING;

  -- POIs (map)
  INSERT INTO public.pois (id, type, name_de, description_de, lat, lon, address) VALUES
    ('b0f00001-0000-4000-8000-000000000001','viewpoint','Aussicht Mühlenberg','Panoramablick über die Müritz.', 53.3771,12.6069,'Mühlenberg, 17207 Röbel'),
    ('b0f00002-0000-4000-8000-000000000002','swim_spot','Badestelle Stadthafen','Beliebte Badestelle mit flachem Einstieg.',53.3735,12.6120,'Am Stadthafen, 17207 Röbel'),
    ('b0f00003-0000-4000-8000-000000000003','bike_rental','Fahrradverleih Altstadt','Leihräder & E-Bikes, täglich 9–18 Uhr.',53.3759,12.6088,'Marktstraße, 17207 Röbel'),
    ('b0f00004-0000-4000-8000-000000000004','tourist_info','Tourist-Information Röbel','Karten, Tipps & Tickets.',53.3760,12.6091,'Marktplatz 1, 17207 Röbel')
  ON CONFLICT DO NOTHING;

  ALTER TABLE public.users       ENABLE TRIGGER USER;
  ALTER TABLE public.posts       ENABLE TRIGGER USER;
  ALTER TABLE public.events      ENABLE TRIGGER USER;
  ALTER TABLE public.restaurants ENABLE TRIGGER USER;

  RAISE NOTICE 'Dummy content seeded (4 users, 6 posts, 3 events, 1 restaurant+menu, 4 POIs).';
END$$;
