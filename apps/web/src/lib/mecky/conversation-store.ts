import { createAdminClient } from "@/lib/supabase/admin";
import type {
  MeckyConversationRow,
  MeckyMessageRow,
} from "@/types/mecky-conversations";

export interface CreateConversationOpts {
  kind?: "chat" | "story";
  title?: string;
  accountId?: string | null;
}

export interface MessageInput {
  role: "user" | "assistant";
  content: string;
  richCards?: unknown;
  navLinks?: unknown;
}

export async function createConversation(
  ownerWallet: string,
  opts?: CreateConversationOpts
): Promise<{ success: boolean; error?: string; conversationId?: string }> {
  try {
    const admin = createAdminClient();
    const wallet = ownerWallet.toLowerCase();

    const { data, error } = await admin.from("mecky_conversations").insert({
      owner_wallet: wallet,
      account_id: opts?.accountId ?? null,
      title: opts?.title ?? "Neuer Chat",
      kind: opts?.kind ?? "chat",
      status: "active",
      draft_article_id: null,
      last_message_at: new Date().toISOString(),
    }).select().single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, conversationId: data?.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function listConversations(
  ownerWallet: string
): Promise<MeckyConversationRow[]> {
  try {
    const admin = createAdminClient();
    const wallet = ownerWallet.toLowerCase();

    const { data, error } = await admin
      .from("mecky_conversations")
      .select("*")
      .eq("owner_wallet", wallet)
      .order("last_message_at", { ascending: false });

    if (error) {
      console.error("listConversations error:", error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("listConversations exception:", err);
    return [];
  }
}

export async function getConversationMessages(
  conversationId: string
): Promise<MeckyMessageRow[]> {
  try {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("mecky_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("getConversationMessages error:", error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("getConversationMessages exception:", err);
    return [];
  }
}

export async function appendMessage(
  conversationId: string,
  message: MessageInput
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  try {
    const admin = createAdminClient();
    const now = new Date().toISOString();

    // Insert the message
    const { data, error: insertError } = await admin
      .from("mecky_messages")
      .insert({
        conversation_id: conversationId,
        role: message.role,
        content: message.content,
        rich_cards: message.richCards ?? null,
        nav_links: message.navLinks ?? null,
        created_at: now,
      }).select().single();

    if (insertError) {
      return { success: false, error: insertError.message };
    }

    // Bump last_message_at on the conversation
    const { error: updateError } = await admin
      .from("mecky_conversations")
      .update({ last_message_at: now })
      .eq("id", conversationId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true, messageId: data?.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function setDraftArticleId(
  conversationId: string,
  articleId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = createAdminClient();

    const { error } = await admin
      .from("mecky_conversations")
      .update({ draft_article_id: articleId })
      .eq("id", conversationId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function renameConversation(
  conversationId: string,
  newTitle: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = createAdminClient();

    const { error } = await admin
      .from("mecky_conversations")
      .update({ title: newTitle })
      .eq("id", conversationId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function archiveConversation(
  conversationId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = createAdminClient();

    const { error } = await admin
      .from("mecky_conversations")
      .update({ status: "archived" })
      .eq("id", conversationId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
