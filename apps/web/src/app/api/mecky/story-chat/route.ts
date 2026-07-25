/**
 * POST /api/mecky/story-chat — server-side story INTERVIEW route.
 *
 * Mecky (Sonnet) streams a warm interview back to the client, and each
 * turn is best-effort persisted to the Mecky conversation store so the
 * transcript survives to feed /api/mecky/story-draft later.
 *
 * Body: { conversationId, walletAddress, messages } (UIMessage[] from useChat)
 */
import { streamText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { appendMessage } from "@/lib/mecky/conversation-store";
import { STORY_INTERVIEW_SYSTEM } from "@/lib/story/prompts";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const { conversationId, walletAddress, messages } = await request.json();
  // walletAddress accepted for forward-compat (future auth/ownership checks);
  // not used yet — appendMessage only persists role + content.
  void walletAddress;

  // Best-effort: persist the user's turn BEFORE streaming the reply, so the
  // transcript is saved even if the client disconnects mid-stream.
  const lastMessage = messages?.[messages.length - 1];
  if (lastMessage?.role === "user") {
    const text = (lastMessage.parts ?? [])
      .filter((part: { type: string }) => part.type === "text")
      .map((part: { text: string }) => part.text)
      .join("");

    if (conversationId && text) {
      try {
        await appendMessage(conversationId, { role: "user", content: text });
      } catch (e) {
        console.error(e);
      }
    }
  }

  const result = streamText({
    model: anthropic("claude-sonnet-4-6"),
    system: STORY_INTERVIEW_SYSTEM,
    messages,
    onFinish: async ({ text }) => {
      if (conversationId) {
        try {
          await appendMessage(conversationId, { role: "assistant", content: text });
        } catch (e) {
          console.error(e);
        }
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
