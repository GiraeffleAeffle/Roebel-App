import type { ArticleDraft, StorySubject } from "./prompts";

export interface DraftSources {
  loadTranscript(conversationId: string): Promise<{ role: "user" | "assistant"; content: string }[]>;
  createDraftArticle(input: {
    accountId: string;
    authorAccountId: string;
    draft: ArticleDraft;
  }): Promise<{ articleId: string; slug: string }>;
  linkDraft(conversationId: string, articleId: string): Promise<void>;
}

export type GenerateDraft = (
  subject: StorySubject,
  transcript: { role: "user" | "assistant"; content: string }[],
) => Promise<ArticleDraft>;

export interface CreateStoryDraftResult {
  ok: boolean;
  reason?: "empty_transcript";
  articleId?: string;
  slug?: string;
}

export async function createStoryDraft(
  conversationId: string,
  subject: StorySubject,
  accountId: string,
  authorAccountId: string,
  deps: DraftSources & { generateDraft: GenerateDraft; minUserTurns?: number },
): Promise<CreateStoryDraftResult> {
  const minUserTurns = deps.minUserTurns ?? 2;
  const transcript = await deps.loadTranscript(conversationId);
  const userTurns = transcript.filter((m) => m.role === "user").length;
  if (userTurns < minUserTurns) {
    return { ok: false, reason: "empty_transcript" };
  }

  const draft = await deps.generateDraft(subject, transcript);
  const { articleId, slug } = await deps.createDraftArticle({ accountId, authorAccountId, draft });
  await deps.linkDraft(conversationId, articleId);

  return { ok: true, articleId, slug };
}
