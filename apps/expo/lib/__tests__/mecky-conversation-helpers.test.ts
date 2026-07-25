import { deriveTitle, rowToMeckyMessage, rowsToHistory } from '../mecky-conversation-helpers';
import type { MeckyMessageRow } from '../types/mecky';

describe('deriveTitle', () => {
  it('trims and collapses whitespace', () => {
    expect(deriveTitle('   Hallo   Mecky  ')).toBe('Hallo Mecky');
  });
  it('truncates long text at a word boundary with an ellipsis', () => {
    const t = deriveTitle('Ich moechte die Geschichte unseres neuen Cafés am Hafen erzaehlen bitte');
    expect(t.length).toBeLessThanOrEqual(49);
    expect(t.endsWith('…')).toBe(true);
  });
  it('falls back to "Neuer Chat" on empty input', () => {
    expect(deriveTitle('   ')).toBe('Neuer Chat');
  });
  it('hard-cuts at MAX_TITLE when there is no space within the first ~20 chars of the slice', () => {
    const t = deriveTitle('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(t.length).toBeLessThanOrEqual(49);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('rowToMeckyMessage', () => {
  it('maps a row incl. rich cards + nav links and derives a numeric timestamp', () => {
    const row: MeckyMessageRow = {
      id: 'm1', conversation_id: 'c1', role: 'assistant', content: 'Hier sind Events',
      rich_cards: { type: 'events', items: [{ id: 'e1' }] },
      nav_links: [{ route: '/events', label: 'Alle Events' }],
      created_at: '2026-07-25T10:00:00.000Z',
    };
    const m = rowToMeckyMessage(row);
    expect(m.id).toBe('m1');
    expect(m.role).toBe('assistant');
    expect(m.content).toBe('Hier sind Events');
    expect(m.richCards).toEqual({ type: 'events', items: [{ id: 'e1' }] });
    expect(m.navigationLinks).toEqual([{ route: '/events', label: 'Alle Events' }]);
    expect(m.timestamp).toBe(Date.parse('2026-07-25T10:00:00.000Z'));
  });
  it('omits richCards/navigationLinks when null', () => {
    const row: MeckyMessageRow = {
      id: 'm2', conversation_id: 'c1', role: 'user', content: 'Moin',
      rich_cards: null, nav_links: null, created_at: '2026-07-25T10:01:00.000Z',
    };
    const m = rowToMeckyMessage(row);
    expect(m.richCards).toBeUndefined();
    expect(m.navigationLinks).toBeUndefined();
  });
  it('omits navigationLinks when nav_links is a non-null empty array', () => {
    const row: MeckyMessageRow = {
      id: 'm3', conversation_id: 'c1', role: 'assistant', content: 'Kein Link',
      rich_cards: null, nav_links: [], created_at: '2026-07-25T10:02:00.000Z',
    };
    const m = rowToMeckyMessage(row);
    expect(m.navigationLinks).toBeUndefined();
  });
});

describe('rowsToHistory', () => {
  it('produces text-only role/content turns in order', () => {
    const rows: MeckyMessageRow[] = [
      { id: 'm1', conversation_id: 'c1', role: 'user', content: 'Hallo', rich_cards: null, nav_links: null, created_at: '2026-07-25T10:00:00Z' },
      { id: 'm2', conversation_id: 'c1', role: 'assistant', content: 'Moin!', rich_cards: { type: 'events', items: [] }, nav_links: null, created_at: '2026-07-25T10:01:00Z' },
    ];
    expect(rowsToHistory(rows)).toEqual([
      { role: 'user', content: 'Hallo' },
      { role: 'assistant', content: 'Moin!' },
    ]);
  });

  it('omits rows with empty or whitespace-only content (rich-cards-only assistant turns) while keeping non-empty rows in order', () => {
    const rows: MeckyMessageRow[] = [
      { id: 'm1', conversation_id: 'c1', role: 'user', content: 'Zeig mir Events', rich_cards: null, nav_links: null, created_at: '2026-07-25T10:00:00Z' },
      { id: 'm2', conversation_id: 'c1', role: 'assistant', content: '', rich_cards: { type: 'events', items: [{ id: 'e1' }] }, nav_links: null, created_at: '2026-07-25T10:01:00Z' },
      { id: 'm3', conversation_id: 'c1', role: 'assistant', content: '   ', rich_cards: null, nav_links: [{ route: '/events', label: 'Alle Events' }], created_at: '2026-07-25T10:01:30Z' },
      { id: 'm4', conversation_id: 'c1', role: 'user', content: 'Danke!', rich_cards: null, nav_links: null, created_at: '2026-07-25T10:02:00Z' },
    ];
    expect(rowsToHistory(rows)).toEqual([
      { role: 'user', content: 'Zeig mir Events' },
      { role: 'user', content: 'Danke!' },
    ]);
  });
});
