import { supabase } from './supabase';
import type { MeckyConversation, MeckyMessageRow, RichCardData, NavigationLink } from './types/mecky';

// ── Reads ────────────────────────────────────────────────────

export async function listConversations(ownerWallet: string): Promise<MeckyConversation[]> {
  const { data, error } = await supabase
    .from('mecky_conversations' as any)
    .select('*')
    .eq('owner_wallet', ownerWallet.toLowerCase())
    .eq('status', 'active')
    .order('last_message_at', { ascending: false });

  if (error) {
    console.error('listConversations error:', error);
    return [];
  }
  return (data || []) as MeckyConversation[];
}

export async function getConversationMessages(conversationId: string): Promise<MeckyMessageRow[]> {
  const { data, error } = await supabase
    .from('mecky_messages' as any)
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getConversationMessages error:', error);
    return [];
  }
  return (data || []) as MeckyMessageRow[];
}

// ── Writes ───────────────────────────────────────────────────

export async function createConversation(
  ownerWallet: string,
  opts?: { title?: string; kind?: 'chat' | 'story'; accountId?: string | null }
): Promise<{ success: true; data: MeckyConversation } | { success: false; error: string }> {
  const { data, error } = await supabase
    .from('mecky_conversations' as any)
    .insert({
      owner_wallet: ownerWallet.toLowerCase(),
      title: opts?.title ?? 'Neuer Chat',
      kind: opts?.kind ?? 'chat',
      account_id: opts?.accountId ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('createConversation error:', error);
    return { success: false, error: 'Fehler beim Erstellen' };
  }
  return { success: true, data: data as MeckyConversation };
}

export async function appendMessage(
  conversationId: string,
  msg: {
    role: 'user' | 'assistant';
    content: string;
    richCards?: RichCardData | null;
    navLinks?: NavigationLink[] | null;
  }
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase
    .from('mecky_messages' as any)
    .insert({
      conversation_id: conversationId,
      role: msg.role,
      content: msg.content,
      rich_cards: msg.richCards ?? null,
      nav_links: msg.navLinks ?? null,
    });

  if (error) {
    console.error('appendMessage error:', error);
    return { success: false, error: 'Fehler beim Senden' };
  }

  const { error: updateError } = await supabase
    .from('mecky_conversations' as any)
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  if (updateError) {
    console.error('appendMessage last_message_at update error:', updateError);
    return { success: false, error: 'Fehler beim Aktualisieren' };
  }

  return { success: true };
}

export async function renameConversation(
  conversationId: string,
  title: string
): Promise<{ success: boolean }> {
  const { error } = await supabase
    .from('mecky_conversations' as any)
    .update({ title })
    .eq('id', conversationId);

  if (error) {
    console.error('renameConversation error:', error);
    return { success: false };
  }
  return { success: true };
}

export async function archiveConversation(
  conversationId: string
): Promise<{ success: boolean }> {
  const { error } = await supabase
    .from('mecky_conversations' as any)
    .update({ status: 'archived' })
    .eq('id', conversationId);

  if (error) {
    console.error('archiveConversation error:', error);
    return { success: false };
  }
  return { success: true };
}
