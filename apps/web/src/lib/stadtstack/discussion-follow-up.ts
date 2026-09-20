import { verifyEvent } from "@netizen-labs/nostr";
import type { StagingThreadResponse } from "./staging-api";

const HEX64 = /^[0-9a-f]{64}$/u;
const POST_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{64})$/u;
export const FOLLOW_UP_COMMENT_LIMIT = 500;

export type DiscussionFollowUp = Readonly<{
  discussionId: string;
  sourcePostId: string;
  title: string;
}>;

export function discussionFollowUpHref(discussionId: string, sourcePostId: string): string {
  if (!HEX64.test(discussionId) || !POST_ID.test(sourcePostId)) throw Error("discussion_follow_up_invalid");
  return `/app/posts/${sourcePostId}?discussion=${discussionId}#discussion-follow-up`;
}

/** The URL selects a context; the signed public root must bind it to this post. */
export function readDiscussionFollowUp(thread: StagingThreadResponse, discussionId: string, sourcePostId: string): DiscussionFollowUp {
  const root = thread.rootEvent;
  const tag = (name: string): string | undefined => {
    const values = root?.tags.filter(value => value[0] === name) ?? [];
    return values.length === 1 && values[0]!.length === 2 ? values[0]![1] : undefined;
  };
  if (!HEX64.test(discussionId) || !POST_ID.test(sourcePostId) || !root ||
    !verifyEvent(root) || root.id !== discussionId || thread.authorityBinding !== "none" ||
    thread.sourceAppPostId !== sourcePostId || tag("source-app-post") !== sourcePostId ||
    tag("t") !== "stadtstack-civic-discussion" || tag("stance") !== "root" ||
    !thread.topic?.title || tag("topic-title") !== thread.topic.title || tag("topic") !== thread.topic.id ||
    !tag("municipality") || !thread.topic.id.startsWith(`urn:stadtstack:topic:municipality:${tag("municipality")}:`)) {
    throw Error("discussion_follow_up_mismatch");
  }
  return { discussionId, sourcePostId, title: thread.topic.title };
}

export function discussionFollowUpSuffix(context: DiscussionFollowUp, publicOrigin: string): string {
  const origin = new URL(publicOrigin);
  if (origin.origin !== publicOrigin || origin.username || origin.password ||
    !(origin.protocol === "https:" || (origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname))) ||
    !HEX64.test(context.discussionId)) throw Error("discussion_follow_up_invalid");
  return `\n\nDiskussion: ${origin.origin}/app/diskussion/${context.discussionId}#citizen-brief`;
}

export function discussionFollowUpComment(question: string, context: DiscussionFollowUp, publicOrigin: string): string {
  const trimmed = question.trim();
  if (!trimmed || /^@mecky\s*[,!:?]?$/iu.test(trimmed)) throw Error("Bitte ergänze deine Rückfrage.");
  const content = trimmed + discussionFollowUpSuffix(context, publicOrigin);
  if (content.length > FOLLOW_UP_COMMENT_LIMIT) throw Error("Bitte kürze deine Rückfrage.");
  return content;
}

/** Keep the signed content intact; show its exact same-origin reference as a readable link. */
export function discussionFollowUpPresentation(content: string, publicOrigin: string): { text: string; href?: string } {
  const footer = /\n\nDiskussion: (\S+)$/u.exec(content);
  if (footer) {
    try {
      const url = new URL(footer[1]!);
      if (url.origin === publicOrigin && !url.username && !url.password && !url.search &&
        /^\/app\/diskussion\/[0-9a-f]{64}$/u.test(url.pathname) && url.hash === "#citizen-brief") {
        return { text: content.slice(0, footer.index), href: url.pathname + url.hash };
      }
    } catch { /* Ordinary comment text stays visible. */ }
  }
  return { text: content };
}
