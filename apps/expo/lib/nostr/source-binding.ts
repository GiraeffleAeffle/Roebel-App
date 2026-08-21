const APP_SOURCE_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{64})$/i;
const NOSTR_PUBKEY = /^[0-9a-f]{64}$/i;
const MECKY_MENTION = /(?:^|[^\p{L}\p{N}_])@mecky(?![\p{L}\p{N}_])/iu;

function sourceId(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!APP_SOURCE_ID.test(normalized)) {
    throw new Error(`${label}_invalid`);
  }
  return normalized;
}

function meckyMentionTag(
  content: string,
  configuredPubkey: string | undefined,
): string[][] {
  if (!MECKY_MENTION.test(content)) return [];
  const pubkey = configuredPubkey?.trim().toLowerCase();
  if (!pubkey) return [];
  if (!NOSTR_PUBKEY.test(pubkey)) {
    throw new Error('mecky_nostr_pubkey_invalid');
  }
  return [['p', pubkey]];
}

/**
 * Bind a signed Nostr mirror to the ordinary Röbel post that remains the
 * product source of truth. A plain-text @Mecky becomes a real NIP-01 mention
 * only when the deployment provides the exact agent pubkey.
 */
export function appPostMirrorTags(input: {
  postId: string;
  content: string;
  meckyPubkey?: string;
}): string[][] {
  return [
    ['source-app-post', sourceId(input.postId, 'source_app_post')],
    ...meckyMentionTag(input.content, input.meckyPubkey),
  ];
}

/** Bind a signed top-level reply to both its Röbel post and comment rows. */
export function appCommentMirrorTags(input: {
  postId: string;
  commentId: string;
  content: string;
  meckyPubkey?: string;
}): string[][] {
  return [
    ['source-app-post', sourceId(input.postId, 'source_app_post')],
    ['source-app-comment', sourceId(input.commentId, 'source_app_comment')],
    ...meckyMentionTag(input.content, input.meckyPubkey),
  ];
}
