import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import type { DecodedMessage } from '@xmtp/react-native-sdk';

import { useActiveAccount } from 'thirdweb/react';

import { useWalletBoot } from '@/context/WalletBootContext';
import {
  bootXmtpClient,
  dropXmtpClient,
  getXmtpClient,
  type XmtpClientHandle,
} from '@/lib/xmtp/client';
import { loadXmtp } from '@/lib/xmtp/native';
import { registerForXmtpPush } from '@/lib/xmtp/pushRegistration';
import { fetchXmtpDmsEnabled } from '@/lib/supabase-app-settings';

interface XmtpContextValue {
  /** Null until boot succeeds (or forever on old builds / kill switch). */
  handle: XmtpClientHandle | null;
  /** True once the boot attempt has settled (success OR failure). */
  ready: boolean;
  /** Registration is possible but hasn't happened on this device yet. */
  activationAvailable: boolean;
  /** An explicit activation is in flight. */
  activating: boolean;
  /** German user-facing error from the last activation attempt. */
  activationError: string | null;
  /** Explicit first-time registration ("Private Nachrichten aktivieren"). */
  activate: () => Promise<boolean>;
  /** Subscribe to every inbound/outbound streamed message. Returns unsubscribe. */
  subscribeMessages: (cb: (message: DecodedMessage<any>) => void) => () => void;
}

const XmtpContext = createContext<XmtpContextValue>({
  handle: null,
  ready: false,
  activationAvailable: false,
  activating: false,
  activationError: null,
  activate: async () => false,
  subscribeMessages: () => () => {},
});

export function useXmtp(): XmtpContextValue {
  return useContext(XmtpContext);
}

/**
 * Boots the XMTP client once the wallet layer is settled and streams all DM
 * messages to subscribers (MessagingContext + open threads).
 *
 * Boot gating mirrors the UserContext invariant: during the cold-start
 * reconnect window (autoConnectFinished === false) we neither boot nor tear
 * down. Only a real logout (no account AFTER autoConnect settled) drops the
 * client.
 */
export function XmtpProvider({ children }: { children: React.ReactNode }) {
  const { autoConnectFinished } = useWalletBoot();
  // XMTP signs with the app's primary smart account, on Gnosis since the
  // 2026-07-27 consolidation — see XMTP_SIGNER_CHAIN_ID. The address is
  // unchanged (deterministic across chains), so peer addressing is unaffected.
  const activeAccount = useActiveAccount();

  const [handle, setHandle] = useState<XmtpClientHandle | null>(() => getXmtpClient());
  const [ready, setReady] = useState(false);
  const [activationAvailable, setActivationAvailable] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const subscribersRef = useRef<Set<(m: DecodedMessage<any>) => void>>(new Set());
  const streamingForRef = useRef<string | null>(null);

  // ── Boot / teardown ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    if (!autoConnectFinished) return; // still reconnecting — do nothing
    if (!activeAccount) {
      // Real logout: settle as ready-without-client and drop any old client.
      setReady(true);
      setActivationAvailable(false);
      if (handle) {
        setHandle(null);
        streamingForRef.current = null;
        dropXmtpClient();
      }
      return;
    }
    if (handle?.wallet === activeAccount.address.toLowerCase()) {
      setReady(true);
      return;
    }

    (async () => {
      // Silent boot only resumes an existing registration (Client.build, no
      // signature). First-time registration is user-triggered via activate().
      const booted = await bootXmtpClient(activeAccount, { allowRegister: false });
      if (cancelled) return;
      setHandle(booted);
      setReady(true);
      if (booted) {
        setActivationAvailable(false);
      } else {
        const [sdk, enabled] = await Promise.all([loadXmtp(), fetchXmtpDmsEnabled()]);
        if (!cancelled) setActivationAvailable(sdk != null && enabled);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnectFinished, activeAccount?.address]);

  // ── Explicit activation ("Private Nachrichten aktivieren") ─────
  const activate = useCallback(async (): Promise<boolean> => {
    if (!activeAccount || activating) return false;
    setActivating(true);
    setActivationError(null);
    try {
      const booted = await bootXmtpClient(activeAccount, {
        allowRegister: true,
        rethrow: true,
      });
      if (booted) {
        setHandle(booted);
        setActivationAvailable(false);
        return true;
      }
      setActivationError('Aktivierung derzeit nicht möglich.');
      return false;
    } catch (err) {
      console.error('[xmtp] activation failed', err);
      setActivationError('Aktivierung fehlgeschlagen. Bitte versuche es erneut.');
      return false;
    } finally {
      setActivating(false);
    }
  }, [activeAccount, activating]);

  // ── Message stream (re-armed on foreground AND after mid-session drops) ──
  const startStream = useCallback(async (h: XmtpClientHandle) => {
    const streamKey = `${h.wallet}:${Date.now()}`;
    streamingForRef.current = streamKey;

    // Network blips kill the gRPC stream without an app-state change (seen
    // live: "h2 protocol error" on SubscribeGroupMessages). Re-arm after a
    // short pause instead of waiting for the next foreground.
    const scheduleRearm = () => {
      if (streamingForRef.current !== streamKey) return;
      streamingForRef.current = null;
      setTimeout(() => {
        if (!streamingForRef.current && AppState.currentState === 'active') {
          startStream(h);
        }
      }, 3000);
    };

    try {
      await h.client.conversations.streamAllMessages(
        async (message) => {
          for (const cb of subscribersRef.current) {
            try {
              cb(message);
            } catch (err) {
              console.warn('[xmtp] message subscriber threw', err);
            }
          }
        },
        'dms',
        ['allowed', 'unknown'],
        scheduleRearm
      );
    } catch (err) {
      console.warn('[xmtp] streamAllMessages failed', err);
      scheduleRearm();
    }
  }, []);

  useEffect(() => {
    if (!handle) return;
    startStream(handle);
    // Register with the notification server so inbound DMs (incl. external
    // wallets) push while the app is closed. No-op until the server URL is set.
    void registerForXmtpPush(handle);

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && handle && !streamingForRef.current) {
        handle.client.conversations
          .syncAllConversations(['allowed', 'unknown'])
          .catch(() => {});
        startStream(handle);
        // Re-subscribe on foreground to cover conversations created while away.
        void registerForXmtpPush(handle);
      }
    });

    return () => {
      sub.remove();
      streamingForRef.current = null;
      try {
        handle.client.conversations.cancelStreamAllMessages();
      } catch {
        // stream already torn down
      }
    };
  }, [handle, startStream]);

  const subscribeMessages = useCallback((cb: (m: DecodedMessage<any>) => void) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  const value = useMemo<XmtpContextValue>(
    () => ({
      handle,
      ready,
      activationAvailable,
      activating,
      activationError,
      activate,
      subscribeMessages,
    }),
    [handle, ready, activationAvailable, activating, activationError, activate, subscribeMessages]
  );

  return <XmtpContext.Provider value={value}>{children}</XmtpContext.Provider>;
}
