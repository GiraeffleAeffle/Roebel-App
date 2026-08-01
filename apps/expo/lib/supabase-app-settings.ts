import { supabase } from './supabase';

/**
 * Reads a single global key from the `app_settings` table. Returns null on
 * any error or when the key is unset.
 */
async function fetchAppSetting(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) {
    console.error(`fetch app_settings (${key}) error:`, error);
    return null;
  }
  return ((data as { value: string | null } | null)?.value ?? null) || null;
}

/**
 * Shared background audio track that loops under ALL event stories. Set by
 * admins in the web events dashboard. Falls back to null (no track).
 */
export function fetchEventStoriesAudioUrl(): Promise<string | null> {
  return fetchAppSetting('event_stories_audio_url');
}

/**
 * Remote kill switch for the XMTP DM rail. Missing key (or any fetch error)
 * counts as ENABLED so the feature works without seeding the table; setting
 * the key to 'false' flips every client back to Supabase-only sends without
 * an app update.
 */
export async function fetchXmtpDmsEnabled(): Promise<boolean> {
  const value = await fetchAppSetting('xmtp_dms_enabled');
  return value !== 'false';
}

/**
 * Pilot gate for the Netizen Workspace (Buzz) section in the Nostr settings.
 * Opposite default from the kill switches above: this is a NEW pilot surface,
 * so a missing key means OFF — only an explicit 'true' shows the export flow.
 */
export async function fetchBuzzWorkspaceEnabled(): Promise<boolean> {
  const value = await fetchAppSetting('buzz_workspace_enabled');
  return value === 'true';
}
