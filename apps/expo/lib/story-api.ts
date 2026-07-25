/**
 * Thin client for the apps/web "Erzähl deine Geschichte" story engine
 * (Plan B story engine — Mecky-interview → server draft → publish):
 *   - draft creation → POST {base}/api/mecky/story-draft
 *   - publish        → POST {base}/api/mecky/story-publish
 *
 * Base URL resolution mirrors `lib/miniapp-api.ts`: `expo.extra.MINIAPP_API_BASE`
 * / `EXPO_PUBLIC_MINIAPP_API_BASE`, falling back to the production origin.
 */
import Constants from 'expo-constants';

const PROD_API_BASE = 'https://www.roebel.app';

const API_BASE: string =
  (Constants.expoConfig?.extra as { MINIAPP_API_BASE?: string } | undefined)?.MINIAPP_API_BASE ||
  process.env.EXPO_PUBLIC_MINIAPP_API_BASE ||
  PROD_API_BASE;

// Mirrors `StoryKind` in apps/web/src/lib/story/prompts.ts.
export type StorySubjectKind =
  | 'business_launch'
  | 'verein_milestone'
  | 'citizen_story'
  | 'craft'
  | 'event_recap'
  | 'other';

export interface StorySubject {
  kind: StorySubjectKind;
  name: string;
  sub_type?: string;
}

export interface RequestStoryDraftInput {
  conversationId: string;
  subject: StorySubject;
  accountId: string;
  authorAccountId: string;
  walletAddress: string;
}

export interface RequestStoryDraftResult {
  success: boolean;
  articleId?: string;
  slug?: string;
  title?: string;
  excerpt?: string;
  error?: string;
}

export async function requestStoryDraft(
  input: RequestStoryDraftInput
): Promise<RequestStoryDraftResult> {
  try {
    const res = await fetch(`${API_BASE}/api/mecky/story-draft`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const json = (await res.json().catch(() => ({}))) as RequestStoryDraftResult;
    if (!res.ok) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }
    return json;
  } catch (error) {
    console.error('requestStoryDraft error:', error);
    return { success: false, error: 'Verbindung zum Server fehlgeschlagen.' };
  }
}

export interface PublishStoryInput {
  articleId: string;
  accountId: string;
  walletAddress: string;
}

export interface PublishStoryResult {
  success: boolean;
  postId?: string;
  error?: string;
}

export async function publishStoryRemote(
  input: PublishStoryInput
): Promise<PublishStoryResult> {
  try {
    const res = await fetch(`${API_BASE}/api/mecky/story-publish`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const json = (await res.json().catch(() => ({}))) as PublishStoryResult;
    if (!res.ok) {
      return { success: false, error: json.error || `HTTP ${res.status}` };
    }
    return json;
  } catch (error) {
    console.error('publishStoryRemote error:', error);
    return { success: false, error: 'Verbindung zum Server fehlgeschlagen.' };
  }
}
