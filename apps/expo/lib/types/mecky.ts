/**
 * Types for the Mecky AI chatbot
 */

export interface MeckyMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  richCards?: RichCardData;
  navigationLinks?: NavigationLink[];
  timestamp: number;
}

export type RichCardType =
  | 'events'
  | 'restaurants'
  | 'marketplace'
  | 'news'
  | 'movies'
  | 'businesses'
  | 'deals'
  | 'pois'
  | 'transit'
  | 'tours'
  | 'wildlife'
  | 'wildlife_calendar'
  | 'advisories';

export interface RichCardData {
  type: RichCardType;
  items: any[];
}

export interface NavigationLink {
  route: string;
  label: string;
}

export interface MeckyConversation {
  id: string;
  owner_wallet: string;
  account_id: string | null;
  title: string;
  kind: 'chat' | 'story';
  status: 'active' | 'archived';
  draft_article_id: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export interface MeckyMessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  rich_cards: RichCardData | null;
  nav_links: NavigationLink[] | null;
  created_at: string;
}
