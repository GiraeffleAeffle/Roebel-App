/**
 * Context for Mecky AI chatbot state management.
 * Handles conversation messages, streaming, and tool result extraction.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from 'react';
import { useActiveAccount } from 'thirdweb/react';
import { disposeAnthropicChatService, getAnthropicChatService } from '@/lib/services/anthropic-chat';
import { meckyToolDefinitions, executeMeckyTool } from '@/lib/tools/mecky-tools';
import { getMeckySystemPrompt } from '@/lib/prompts/mecky-system-prompt';
import { useConsent } from '@/context/ConsentContext';
import { Events, track } from '@/lib/analytics';
import type { AnthropicMessage } from '@/lib/types/anthropic';
import type { MeckyMessage, MeckyConversation, RichCardData, NavigationLink } from '@/lib/types/mecky';
import {
  listConversations,
  createConversation,
  getConversationMessages,
  appendMessage,
} from '@/lib/supabase-mecky-conversations';
import { deriveTitle, rowToMeckyMessage, rowsToHistory } from '@/lib/mecky-conversation-helpers';

interface MeckyContextValue {
  messages: MeckyMessage[];
  isStreaming: boolean;
  streamingText: string;
  isEnabled: boolean;
  currentConversationId: string | null;
  conversations: MeckyConversation[];
  sendMessage: (text: string) => Promise<void>;
  clearConversation: () => void;
  selectConversation: (id: string) => Promise<void>;
  newConversation: () => void;
  refreshConversations: () => Promise<void>;
}

const MeckyContext = createContext<MeckyContextValue | undefined>(undefined);

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function MeckyProvider({ children }: { children: React.ReactNode }) {
  const account = useActiveAccount();
  const { preferences } = useConsent();
  const isEnabled = preferences.ai_assistant;
  const [messages, setMessages] = useState<MeckyMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<MeckyConversation[]>([]);

  const walletLower = account?.address?.toLowerCase();

  // Drop the cached client when consent is withdrawn so no stale config sticks.
  useEffect(() => {
    if (!isEnabled) disposeAnthropicChatService();
  }, [isEnabled]);

  const refreshConversations = useCallback(async () => {
    if (!walletLower) return;
    setConversations(await listConversations(walletLower));
  }, [walletLower]);

  // Load the conversation list once a wallet becomes available.
  useEffect(() => {
    if (walletLower) {
      refreshConversations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.address]);

  // Anthropic conversation history (includes tool calls/results)
  const historyRef = useRef<AnthropicMessage[]>([]);
  // Collected tool results during current stream
  const toolResultsRef = useRef<{ richCards: RichCardData[]; navLinks: NavigationLink[] }>({
    richCards: [],
    navLinks: [],
  });

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      // Consent gate: refuse to call Anthropic if the user has not opted in.
      if (!isEnabled) {
        const userMsg: MeckyMessage = {
          id: generateId(),
          role: 'user',
          content: text.trim(),
          timestamp: Date.now(),
        };
        const refusalMsg: MeckyMessage = {
          id: generateId(),
          role: 'assistant',
          content:
            'Aktiviere den Mecky-KI Assistenten in den Datenschutz-Einstellungen, um zu chatten.',
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, userMsg, refusalMsg]);
        return;
      }

      // Add user message to UI
      const userMsg: MeckyMessage = {
        id: generateId(),
        role: 'user',
        content: text.trim(),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);

      track(Events.MECKY_MESSAGE_SENT, {
        message_length: text.trim().length,
        turn_index: historyRef.current.length,
      });

      // Add to Anthropic history
      historyRef.current.push({ role: 'user', content: text.trim() });

      // Trim to last 20 messages for API calls to manage token budget
      if (historyRef.current.length > 40) {
        historyRef.current = historyRef.current.slice(-40);
      }

      // Persistence: lazily create a conversation thread on the first message
      // of a turn, then persist the user message. Use a local convId through
      // the rest of this turn — currentConversationId state won't have
      // updated yet within this closure.
      let convId = currentConversationId;
      if (walletLower && convId === null) {
        const res = await createConversation(walletLower, { title: deriveTitle(text.trim()) });
        if (res.success) {
          convId = res.data.id;
          setCurrentConversationId(convId);
        }
      }
      if (walletLower && convId) {
        await appendMessage(convId, { role: 'user', content: text.trim() });
      }

      // Reset streaming state
      setIsStreaming(true);
      setStreamingText('');
      toolResultsRef.current = { richCards: [], navLinks: [] };

      try {
        const service = getAnthropicChatService(true);
        const systemPrompt = getMeckySystemPrompt({
          walletAddress: account?.address,
          userRole: undefined, // Could be enhanced with useUser() but keeping it simple
          today: new Date().toISOString().split('T')[0],
        });

        let finalText = '';

        await service.streamMessage(
          [...historyRef.current],
          systemPrompt,
          meckyToolDefinitions,
          {
            onTextDelta: (delta: string) => {
              finalText += delta;
              setStreamingText(finalText);
            },
            onToolCallComplete: (toolName: string, result: any) => {
              if (!result?.data) return;
              const { displayType, items, route, label } = result.data;

              if (displayType === 'navigation' && route && label) {
                toolResultsRef.current.navLinks.push({ route, label });
              } else if (displayType && items?.length > 0) {
                toolResultsRef.current.richCards.push({
                  type: displayType as RichCardData['type'],
                  items,
                });
              }
            },
            onComplete: async (history: AnthropicMessage[]) => {
              // Update full history with tool calls included
              historyRef.current = history;

              // Build the assistant message
              const assistantMsg: MeckyMessage = {
                id: generateId(),
                role: 'assistant',
                content: finalText,
                timestamp: Date.now(),
              };

              // Attach rich cards (use the last one if multiple tool calls)
              const { richCards, navLinks } = toolResultsRef.current;
              if (richCards.length > 0) {
                assistantMsg.richCards = richCards[richCards.length - 1];
              }
              if (navLinks.length > 0) {
                assistantMsg.navigationLinks = navLinks;
              }

              setMessages((prev) => [...prev, assistantMsg]);
              setStreamingText('');
              setIsStreaming(false);

              if (walletLower && convId) {
                await appendMessage(convId, {
                  role: 'assistant',
                  content: assistantMsg.content,
                  richCards: assistantMsg.richCards ?? null,
                  navLinks: assistantMsg.navigationLinks ?? null,
                });
                await refreshConversations();
              }
            },
            onError: (error: Error) => {
              console.error('Mecky stream error:', error);
              const errorMsg: MeckyMessage = {
                id: generateId(),
                role: 'assistant',
                content: 'Entschuldigung, da ist etwas schiefgelaufen. Bitte versuche es noch einmal.',
                timestamp: Date.now(),
              };
              setMessages((prev) => [...prev, errorMsg]);
              setStreamingText('');
              setIsStreaming(false);
            },
          },
          executeMeckyTool
        );
      } catch (error) {
        console.error('Mecky sendMessage error:', error);
        setStreamingText('');
        setIsStreaming(false);
      }
    },
    [isStreaming, isEnabled, account?.address, walletLower, currentConversationId, refreshConversations]
  );

  // Clears in-memory state and detaches from the current thread; a fresh
  // thread is created lazily on the next sent message.
  const newConversation = useCallback(() => {
    setMessages([]);
    historyRef.current = [];
    setStreamingText('');
    setCurrentConversationId(null);
  }, []);

  // Kept for backwards compatibility with existing call sites.
  const clearConversation = useCallback(() => {
    newConversation();
  }, [newConversation]);

  const selectConversation = useCallback(async (id: string) => {
    const rows = await getConversationMessages(id);
    setMessages(rows.map(rowToMeckyMessage));
    historyRef.current = rowsToHistory(rows).slice(-40);
    setCurrentConversationId(id);
    setStreamingText('');
  }, []);

  const value = useMemo(
    () => ({
      messages,
      isStreaming,
      streamingText,
      isEnabled,
      currentConversationId,
      conversations,
      sendMessage,
      clearConversation,
      selectConversation,
      newConversation,
      refreshConversations,
    }),
    [
      messages,
      isStreaming,
      streamingText,
      isEnabled,
      currentConversationId,
      conversations,
      sendMessage,
      clearConversation,
      selectConversation,
      newConversation,
      refreshConversations,
    ]
  );

  return (
    <MeckyContext.Provider value={value}>{children}</MeckyContext.Provider>
  );
}

export function useMecky(): MeckyContextValue {
  const context = useContext(MeckyContext);
  if (!context) {
    throw new Error('useMecky must be used within MeckyProvider');
  }
  return context;
}
