/**
 * Expo Screen Capture Script
 *
 * Captures all app screens as high-res PNG screenshots using Playwright.
 * Screenshots are saved to ./screenshots/ for Figma import.
 *
 * Prerequisites:
 *   - Expo web server running: npx expo start --web --port 8081
 *   - Playwright installed: npm install --save-dev @playwright/test
 *
 * Usage:
 *   npx tsx scripts/capture-screens.ts
 */

import { chromium, type Page, type Browser } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:8081';
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');
const VIEWPORT = { width: 393, height: 852 }; // iPhone 15 Pro
const WAIT_MS = 4000; // wait for data loading

// Supabase client for fetching real IDs
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

interface ScreenDef {
  route: string;
  name: string;
  /** If true, will be skipped if the dynamic ID couldn't be resolved */
  needsId?: boolean;
}

async function resolveIds(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};

  try {
    const { data: events } = await supabase
      .from('events')
      .select('id')
      .order('start_date', { ascending: false })
      .limit(1);
    if (events?.[0]) ids.eventId = events[0].id;

    const { data: news } = await supabase
      .from('news')
      .select('slug')
      .order('published_at', { ascending: false })
      .limit(1);
    if (news?.[0]) ids.newsSlug = news[0].slug;

    const { data: restaurants } = await supabase
      .from('restaurants')
      .select('slug')
      .limit(1);
    if (restaurants?.[0]) ids.restaurantSlug = restaurants[0].slug;

    const { data: proposals } = await supabase
      .from('proposals')
      .select('id')
      .limit(1);
    if (proposals?.[0]) ids.proposalId = proposals[0].id;

    const { data: movies } = await supabase
      .from('movies')
      .select('id')
      .limit(1);
    if (movies?.[0]) ids.movieId = movies[0].id;

    const { data: deals } = await supabase
      .from('deals')
      .select('id')
      .limit(1);
    if (deals?.[0]) ids.dealId = deals[0].id;

    const { data: marketplace } = await supabase
      .from('marketplace_items')
      .select('id')
      .limit(1);
    if (marketplace?.[0]) ids.marketplaceId = marketplace[0].id;

    const { data: posts } = await supabase
      .from('posts')
      .select('id')
      .limit(1);
    if (posts?.[0]) ids.postId = posts[0].id;
  } catch (err) {
    console.warn('Could not fetch some IDs from Supabase:', err);
  }

  return ids;
}

function buildScreenList(ids: Record<string, string>): ScreenDef[] {
  const screens: ScreenDef[] = [
    // Main tabs
    { route: '/', name: 'Home' },
    { route: '/explore', name: 'Explore' },
    { route: '/location', name: 'Map' },
    { route: '/profile', name: 'Profile' },
    { route: '/governance', name: 'Governance' },

    // Static screens
    { route: '/settings', name: 'Settings' },
    { route: '/news', name: 'News-List' },
    { route: '/restaurant', name: 'Restaurant-List' },
    { route: '/notifications', name: 'Notifications' },
    { route: '/notifications/settings', name: 'Notification-Settings' },
    { route: '/deals', name: 'Deals-List' },
    { route: '/marketplace', name: 'Marketplace-List' },
    { route: '/businesses', name: 'Businesses-List' },
    { route: '/feedback', name: 'Feedback' },
    { route: '/calendar', name: 'Calendar' },
    { route: '/submit-event', name: 'Submit-Event' },
    { route: '/ai-submit', name: 'AI-Submit' },
    { route: '/edit-profile', name: 'Edit-Profile' },
    { route: '/design-system', name: 'Design-System' },
    { route: '/movies', name: 'Movies-List' },
    { route: '/create', name: 'Create' },
    { route: '/create/poll', name: 'Create-Poll' },
    { route: '/create/review', name: 'Create-Review' },
    { route: '/create/marketplace', name: 'Create-Marketplace' },

    // Messages (stub on web)
    { route: '/messages', name: 'Messages' },
    { route: '/messages/new', name: 'Messages-New' },

    // Verification
    { route: '/verification/scan', name: 'Verification-Scan' },
    { route: '/verification/my-request', name: 'Verification-MyRequest' },
    { route: '/verification/request-citizen', name: 'Verification-RequestCitizen-Intro' },
    { route: '/verification/request-citizen/form', name: 'Verification-RequestCitizen-Form' },

    // Business
    { route: '/business/register', name: 'Business-Register' },
    { route: '/business/dashboard', name: 'Business-Dashboard' },
    { route: '/business/analytics', name: 'Business-Analytics' },
    { route: '/business/deals/create', name: 'Business-Deals-Create' },

    // Games
    { route: '/games/mecky-jump', name: 'Game-MeckyJump' },
    { route: '/games/mecky-portal', name: 'Game-MeckyPortal' },
    { route: '/games/speedrun', name: 'Game-Speedrun' },
    { route: '/games/fortune-cards', name: 'Game-FortuneCards' },
    { route: '/games/horoscope', name: 'Game-Horoscope' },

    // Categories
    { route: '/category/Kultur', name: 'Category-Kultur' },
    { route: '/category/Sport', name: 'Category-Sport' },
    { route: '/category/Musik', name: 'Category-Musik' },
    { route: '/category/Essen%20%26%20Trinken', name: 'Category-Essen' },
    { route: '/category/Kirchliches', name: 'Category-Kirchliches' },
    { route: '/category/Ausstellungen', name: 'Category-Ausstellungen' },
    { route: '/category/Stadt', name: 'Category-Stadt' },
    { route: '/category/Sonstige', name: 'Category-Sonstige' },
  ];

  // Dynamic routes — only add if we have real IDs
  if (ids.eventId) {
    screens.push({ route: `/event/${ids.eventId}`, name: 'Event-Detail', needsId: true });
    screens.push({ route: `/event/${ids.eventId}/dates`, name: 'Event-Dates', needsId: true });
  }
  if (ids.newsSlug) {
    screens.push({ route: `/news/${ids.newsSlug}`, name: 'News-Detail', needsId: true });
  }
  if (ids.restaurantSlug) {
    screens.push({ route: `/restaurant/${ids.restaurantSlug}`, name: 'Restaurant-Detail', needsId: true });
  }
  if (ids.proposalId) {
    screens.push({ route: `/proposal/${ids.proposalId}`, name: 'Proposal-Detail', needsId: true });
  }
  if (ids.movieId) {
    screens.push({ route: `/movies/${ids.movieId}`, name: 'Movie-Detail', needsId: true });
  }
  if (ids.dealId) {
    screens.push({ route: `/deals/${ids.dealId}`, name: 'Deal-Detail', needsId: true });
  }
  if (ids.marketplaceId) {
    screens.push({ route: `/marketplace/${ids.marketplaceId}`, name: 'Marketplace-Detail', needsId: true });
  }
  if (ids.postId) {
    screens.push({ route: `/post/${ids.postId}`, name: 'Post-Detail', needsId: true });
  }

  return screens;
}

async function captureScreen(
  page: Page,
  screen: ScreenDef,
  index: number,
  total: number
): Promise<boolean> {
  const url = `${BASE_URL}${screen.route}`;
  const filename = `${String(index + 1).padStart(2, '0')}_${screen.name}.png`;
  const filepath = path.join(SCREENSHOT_DIR, filename);

  console.log(`[${index + 1}/${total}] Capturing ${screen.name} → ${screen.route}`);

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
  } catch {
    // networkidle might timeout for pages with persistent connections; just wait
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 15000 });
    } catch (err) {
      console.error(`  ✗ Failed to load ${screen.route}: ${err}`);
      return false;
    }
  }

  await page.waitForTimeout(WAIT_MS);

  await page.screenshot({
    path: filepath,
    fullPage: false, // viewport-sized screenshot
    type: 'png',
  });

  console.log(`  ✓ Saved ${filename}`);
  return true;
}

async function main() {
  // Ensure screenshot directory exists
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  console.log('Resolving dynamic route IDs from Supabase...');
  const ids = await resolveIds();
  console.log('Resolved IDs:', ids);

  const screens = buildScreenList(ids);
  console.log(`\nCapturing ${screens.length} screens...\n`);

  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 3, // 3x for high-res screenshots
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  const page = await context.newPage();

  // Enable extended mode for design-system page
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    localStorage.setItem('extended_mode', 'true');
  });

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < screens.length; i++) {
    const ok = await captureScreen(page, screens[i], i, screens.length);
    if (ok) succeeded++;
    else failed++;
  }

  await browser.close();

  console.log(`\n========================================`);
  console.log(`Done! ${succeeded} captured, ${failed} failed`);
  console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
  console.log(`========================================`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
