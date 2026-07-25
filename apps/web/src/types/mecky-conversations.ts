export interface MeckyConversationRow {
  id: string;
  owner_wallet: string;
  account_id: string | null;
  title: string;
  kind: "chat" | "story";
  status: "active" | "archived";
  draft_article_id: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export interface MeckyMessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  rich_cards: unknown | null;
  nav_links: unknown | null;
  created_at: string;
}
