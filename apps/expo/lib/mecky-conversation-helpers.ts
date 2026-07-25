import type { MeckyMessage, MeckyMessageRow } from './types/mecky';
import type { AnthropicMessage } from './types/anthropic';

const MAX_TITLE = 48;

export function deriveTitle(firstUserContent: string): string {
  const clean = (firstUserContent ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Neuer Chat';
  if (clean.length <= MAX_TITLE) return clean;
  const slice = clean.slice(0, MAX_TITLE);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

export function rowToMeckyMessage(row: MeckyMessageRow): MeckyMessage {
  const msg: MeckyMessage = {
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: Date.parse(row.created_at),
  };
  if (row.rich_cards) msg.richCards = row.rich_cards;
  if (row.nav_links && row.nav_links.length > 0) msg.navigationLinks = row.nav_links;
  return msg;
}

export function rowsToHistory(rows: MeckyMessageRow[]): AnthropicMessage[] {
  return rows.map((r) => ({ role: r.role, content: r.content }));
}
