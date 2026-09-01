import assert from 'node:assert/strict';
import { appCommentMirrorTags, appPostMirrorTags } from './source-binding';

const POST = '735187dc-d737-4e6c-bdd9-fe0792fec498';
const COMMENT = '018f1c63-7b2a-4a11-8a55-2e3d9c4b5a61';
const MECKY = 'ab'.repeat(32);

describe('ordinary Röbel conversation source bindings', () => {
  it('always binds a signed post mirror to its immutable app post id', () => {
    assert.deepEqual(
      appPostMirrorTags({ postId: POST, content: 'Ein normaler Beitrag.' }),
      [['source-app-post', POST]],
    );
  });

  it('turns a real @Mecky phrase into a protocol-level agent mention', () => {
    assert.deepEqual(
      appPostMirrorTags({
        postId: POST.toUpperCase(),
        content: 'Was ist dazu bekannt, @Mecky?',
        meckyPubkey: MECKY.toUpperCase(),
      }),
      [
        ['source-app-post', POST],
        ['p', MECKY],
      ],
    );
  });

  it('does not treat a longer handle or an unbound deployment as Mecky', () => {
    assert.deepEqual(
      appPostMirrorTags({
        postId: POST,
        content: '@MeckyTeam und @Meckyä sind andere Namen.',
        meckyPubkey: MECKY,
      }),
      [['source-app-post', POST]],
    );
    assert.deepEqual(
      appPostMirrorTags({
        postId: POST,
        content: '@Mecky ist nicht an eine Agentenidentität gebunden.',
      }),
      [['source-app-post', POST]],
    );
  });

  it('binds a top-level comment to both source records before mentioning Mecky', () => {
    assert.deepEqual(
      appCommentMirrorTags({
        postId: POST,
        commentId: COMMENT,
        content: '@mecky, kannst du Quellen nennen?',
        meckyPubkey: MECKY,
      }),
      [
        ['source-app-post', POST],
        ['source-app-comment', COMMENT],
        ['p', MECKY],
      ],
    );
  });

  it('rejects ambiguous source ids and a malformed configured agent identity', () => {
    assert.throws(
      () => appPostMirrorTags({ postId: '../post', content: 'normal' }),
      /source_app_post_invalid/,
    );
    assert.throws(
      () => appPostMirrorTags({ postId: POST, content: '@Mecky', meckyPubkey: 'not-a-key' }),
      /mecky_nostr_pubkey_invalid/,
    );
  });
});
