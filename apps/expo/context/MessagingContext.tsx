import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAccount } from '@/context/AccountContext';
import { useXmtp } from '@/context/XmtpContext';
import {
  fetchConversations as fetchConvos,
  getUnreadCount as fetchUnread,
  markConversationRead as markRead,
  fetchPersonalAccountIdByWallet,
  findOrCreateConversation,
  type ConversationWithLastMessage,
} from '@/lib/supabase-messages';
import { loadCachedInbox, saveCachedInbox } from '@/lib/inbox-cache';
import {
  countXmtpUnread,
  listXmtpInbox,
  mapXmtpMessage,
  type XmtpInboxEntry,
} from '@/lib/xmtp/transport';
import { maybeNotifyInboundXmtp } from '@/lib/xmtp/inboundNotify';
import type { XmtpClientHandle } from '@/lib/xmtp/client';

interface MessagingContextValue {
  conversations: ConversationWithLastMessage[];
  unreadCount: number;
  isLoading: boolean;
  refreshConversations: () => Promise<void>;
  markConversationRead: (conversationId: string) => void;
}

const MessagingContext = createContext<MessagingContextValue>({
  conversations: [],
  unreadCount: 0,
  isLoading: false,
  refreshConversations: async () => {},
  markConversationRead: () => {},
});

export function useMessaging() {
  return useContext(MessagingContext);
}

/**
 * XMTP-only inbox for personal chats (2026-07-12 policy): personal-peer rows
 * show ONLY XMTP previews/unread and rows without an XMTP conversation are
 * hidden entirely — legacy Supabase-only chats no longer appear. Org rows
 * keep their Supabase previews. Inbound XMTP DMs without a registry row get
 * one created (Röbel peers only — unknown external wallets are ignored).
 */
async function mergeXmtpInbox(
  handle: XmtpClientHandle,
  myAccountId: string,
  rows: ConversationWithLastMessage[],
  adoptedWallets: Set<string>,
  allowAdoption: boolean
): Promise<{ rows: ConversationWithLastMessage[]; xmtpUnread: number; adopted: boolean }> {
  // The personal inbox is PURE XMTP (2026-07-12): only conversations with an
  // XMTP counterpart appear — legacy Supabase chats AND org chats are hidden.
  // (Org threads still open via marketplace/support deep links; they return
  // to the inbox once org accounts move to XMTP groups.)
  let entries: XmtpInboxEntry[] = [];
  try {
    entries = await listXmtpInbox(handle);
  } catch (err) {
    console.warn('[xmtp] inbox list failed', err);
    return { rows: [], xmtpUnread: 0, adopted: false };
  }
  if (entries.length === 0) {
    return { rows: [], xmtpUnread: 0, adopted: false };
  }

  let xmtpUnread = 0;
  let adopted = false;
  const merged = rows.map((r) => ({ ...r }));
  const matchedRowIds = new Set<string>();

  for (const entry of entries) {
    // Some legacy pairs have MORE THAN ONE registry row (duplicate
    // `conversations` rows). Attach the XMTP thread to the OLDEST row — the
    // one findOrCreateConversation returns — so navigation and the inbox
    // agree; every other row for the same wallet stays unmatched and is
    // filtered out below (this is what used to show a second, stale
    // "Supabase" chat next to the XMTP one).
    const candidates = merged.filter((r) => r.peerOwnerWallet === entry.peerWallet);
    const row =
      candidates.length > 1
        ? candidates.reduce((a, b) =>
            Date.parse(a.created_at) <= Date.parse(b.created_at) ? a : b
          )
        : candidates[0];

    if (!row) {
      // Inbound XMTP DM with no registry row (peer started the chat, possibly
      // from another XMTP app). Adopt it once per wallet per session — but
      // only for wallets that belong to a Röbel personal account.
      if (allowAdoption && !adoptedWallets.has(entry.peerWallet)) {
        adoptedWallets.add(entry.peerWallet);
        try {
          const peerAccountId = await fetchPersonalAccountIdByWallet(entry.peerWallet);
          if (peerAccountId && peerAccountId !== myAccountId) {
            await findOrCreateConversation(myAccountId, peerAccountId);
            adopted = true;
          }
        } catch (err) {
          console.warn('[xmtp] adoption failed', err);
        }
      }
      continue;
    }

    matchedRowIds.add(row.id);

    // Personal chats are XMTP-only: preview comes from the XMTP side alone
    // (legacy Supabase previews are discarded).
    row.lastMessage = null;
    row.hasUnread = false;
    if (entry.lastMessage) {
      const mapped = mapXmtpMessage(
        entry.lastMessage,
        { conversationId: row.id, myAccountId, peerAccountId: row.peerAccountId },
        handle
      );
      if (mapped) {
        if (mapped.payment) mapped.content = '💰 Röbel Münzen';
        row.lastMessage = mapped;
      }
    }

    // Unread: XMTP-only. Skip the local-db count when the newest XMTP
    // message can't be unread anyway.
    const last = entry.lastMessage;
    const lastFromPeer = last && last.senderInboxId !== handle.inboxId;
    const lastIsNew =
      !!last &&
      (!row.lastReadAt || last.sentNs / 1e6 > Date.parse(row.lastReadAt));
    if (lastFromPeer && lastIsNew) {
      const unread = await countXmtpUnread(handle, entry.dm, row.lastReadAt);
      if (unread > 0) {
        xmtpUnread += unread;
        row.hasUnread = true;
      }
    }
  }

  // Only the rows an XMTP thread was attached to survive — everything else
  // (legacy Supabase personal chats, duplicate registry rows for the same
  // peer, org chats) is hidden from the inbox.
  const visible = merged.filter((r) => matchedRowIds.has(r.id));

  visible.sort((a, b) => {
    const ta = a.lastMessage?.created_at ?? a.created_at;
    const tb = b.lastMessage?.created_at ?? b.created_at;
    return Date.parse(tb) - Date.parse(ta);
  });

  return { rows: visible, xmtpUnread, adopted };
}

export function MessagingProvider({ children }: { children: React.ReactNode }) {
  const { activeAccount } = useAccount();
  const activeAccountId = activeAccount?.id ?? null;
  const activeAccountType = (activeAccount as any)?.account_type as string | undefined;

  const { handle: xmtp, ready: xmtpReady, subscribeMessages } = useXmtp();

  const [conversations, setConversations] = useState<ConversationWithLastMessage[]>([]);
  const [baseUnread, setBaseUnread] = useState(0);
  const [xmtpUnread, setXmtpUnread] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const accountIdRef = useRef<string | null>(null);
  const accountTypeRef = useRef<string | undefined>(undefined);
  const xmtpRef = useRef<XmtpClientHandle | null>(null);
  const adoptedWalletsRef = useRef<Set<string>>(new Set());
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supabaseReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  accountTypeRef.current = activeAccountType;
  xmtpRef.current = xmtp;

  const loadConversations = useCallback(async (accountId: string) => {
    setIsLoading(true);
    try {
      let convos = await fetchConvos(accountId);

      const handle = xmtpRef.current;
      if (handle && accountTypeRef.current === 'personal') {
        let result = await mergeXmtpInbox(
          handle,
          accountId,
          convos,
          adoptedWalletsRef.current,
          true
        );
        if (result.adopted) {
          // A registry row was created for an inbound XMTP DM — refetch once
          // so the new conversation appears with full peer hydration.
          const refreshed = await fetchConvos(accountId);
          result = await mergeXmtpInbox(
            handle,
            accountId,
            refreshed,
            adoptedWalletsRef.current,
            false
          );
        }
        convos = result.rows;
        if (accountIdRef.current === accountId) setXmtpUnread(result.xmtpUnread);
      } else {
        // No XMTP client (not yet activated): the personal inbox is pure
        // XMTP, so nothing is listed until activation.
        if (accountTypeRef.current === 'personal') {
          convos = [];
        }
        if (accountIdRef.current === accountId) setXmtpUnread(0);
      }

      // Personal accounts: the badge is XMTP-only (the get_unread_count RPC
      // would count hidden legacy Supabase messages).
      if (accountTypeRef.current === 'personal' && accountIdRef.current === accountId) {
        setBaseUnread(0);
      }

      // Guard against stale loads after an account switch.
      if (accountIdRef.current === accountId) {
        // Personal inbox before XMTP has booted is a placeholder [] (forced
        // above), not authoritative data. Applying it would blank the
        // cache-hydrated snapshot on screen and persist an empty list over
        // the last-known-good cache on every cold start (XMTP boot lags the
        // Supabase fetch). Skip both — the "XMTP ready" effect re-runs
        // loadConversations with the real merged list moments later.
        const isPersonalAwaitingXmtp =
          accountTypeRef.current === 'personal' && !handle;
        if (!isPersonalAwaitingXmtp) {
          setConversations(convos);
          void saveCachedInbox(accountId, convos);
        }
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      if (accountIdRef.current === accountId) {
        setIsLoading(false);
      }
    }
  }, []);

  const loadUnreadCount = useCallback(async (accountId: string) => {
    // Personal accounts derive their badge in loadConversations (XMTP +
    // visible org rows) — the RPC would count hidden legacy messages.
    if (accountTypeRef.current === 'personal') return;
    try {
      const count = await fetchUnread(accountId);
      if (accountIdRef.current === accountId) {
        setBaseUnread(count);
      }
    } catch (err) {
      console.error('Failed to load unread count:', err);
    }
  }, []);

  const refreshConversations = useCallback(async () => {
    const id = accountIdRef.current;
    if (!id) return;
    await Promise.all([loadConversations(id), loadUnreadCount(id)]);
  }, [loadConversations, loadUnreadCount]);

  const handleMarkRead = useCallback((conversationId: string) => {
    const id = accountIdRef.current;
    if (!id) return;
    markRead(conversationId, id);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conversationId ? { ...c, hasUnread: false, lastReadAt: new Date().toISOString() } : c
      )
    );
    setBaseUnread((prev) => Math.max(0, prev - 1));
  }, []);

  // Load whenever the active account changes (incl. switching between
  // personal and an owned org). Strict scoping: switching the account
  // swaps the inbox entirely.
  useEffect(() => {
    if (!activeAccountId) {
      accountIdRef.current = null;
      setConversations([]);
      setBaseUnread(0);
      setXmtpUnread(0);
      return;
    }
    accountIdRef.current = activeAccountId;
    // Cold-start hydration: show the last-known inbox instantly while the
    // real load (network + XMTP merge) runs. Never overwrites fresher data.
    void loadCachedInbox(activeAccountId).then((cached) => {
      if (!cached || accountIdRef.current !== activeAccountId) return;
      setConversations((prev) => (prev.length > 0 ? prev : cached));
    });
    loadConversations(activeAccountId);
    loadUnreadCount(activeAccountId);
  }, [activeAccountId, loadConversations, loadUnreadCount]);

  // When the XMTP client becomes ready after the first load, merge it in.
  useEffect(() => {
    if (!xmtpReady || !xmtp) return;
    const id = accountIdRef.current;
    if (id) loadConversations(id);
  }, [xmtpReady, xmtp, loadConversations]);

  // Realtime (Supabase rail): any new direct_messages insert triggers a
  // refetch scoped to the active account.
  useEffect(() => {
    if (!activeAccountId) return;

    const channel = supabase
      .channel(`messaging-realtime-${activeAccountId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'direct_messages' },
        (payload) => {
          const current = accountIdRef.current;
          if (!current) return;

          // Instant optimistic patch when the conversation is already
          // visible — no network needed to show the new preview/badge.
          const row = payload.new as any;
          if (row?.conversation_id) {
            setConversations((prev) => {
              const idx = prev.findIndex((c) => c.id === row.conversation_id);
              if (idx === -1) return prev;
              const updated = {
                ...prev[idx],
                lastMessage: row,
                hasUnread:
                  row.sender_account_id !== current ? true : prev[idx].hasUnread,
              };
              const next = [...prev];
              next[idx] = updated;
              next.sort((a, b) => {
                const ta = a.lastMessage?.created_at ?? a.created_at;
                const tb = b.lastMessage?.created_at ?? b.created_at;
                return new Date(tb).getTime() - new Date(ta).getTime();
              });
              return next;
            });
          }

          // Authoritative reload, coalesced WITHOUT re-arming: a burst of
          // inserts triggers ONE refetch, at most 1.2s after the first
          // insert of the burst (bounded staleness) — a steady insert stream
          // must not postpone the reload indefinitely.
          if (!supabaseReloadTimerRef.current) {
            supabaseReloadTimerRef.current = setTimeout(() => {
              supabaseReloadTimerRef.current = null;
              const id = accountIdRef.current;
              if (id) {
                loadConversations(id);
                loadUnreadCount(id);
              }
            }, 1200);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (supabaseReloadTimerRef.current) {
        clearTimeout(supabaseReloadTimerRef.current);
        supabaseReloadTimerRef.current = null;
      }
    };
  }, [activeAccountId, loadConversations, loadUnreadCount]);

  // Realtime (XMTP rail): stream events debounce into an inbox refresh, and
  // inbound messages from external wallets (which have no sender-triggered
  // remote push) fire a local notification.
  useEffect(() => {
    if (!xmtp) return;
    const unsubscribe = subscribeMessages((message) => {
      void maybeNotifyInboundXmtp(xmtp, message);
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        const current = accountIdRef.current;
        if (current) loadConversations(current);
      }, 500);
    });
    return () => {
      unsubscribe();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [xmtp, subscribeMessages, loadConversations]);

  const value = useMemo<MessagingContextValue>(
    () => ({
      conversations,
      unreadCount: baseUnread + xmtpUnread,
      isLoading,
      refreshConversations,
      markConversationRead: handleMarkRead,
    }),
    [conversations, baseUnread, xmtpUnread, isLoading, refreshConversations, handleMarkRead]
  );

  return (
    <MessagingContext.Provider value={value}>
      {children}
    </MessagingContext.Provider>
  );
}
