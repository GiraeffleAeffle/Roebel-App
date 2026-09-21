"use client";

import { meckyPresentation, meckySourceHref } from "@/lib/mecky-presentation";

import { useEffect, useRef, useState } from "react";
import { Bot, ExternalLink, Send, ShieldCheck, User } from "lucide-react";

import { useAccount } from "@/lib/context/AccountContext";
import type { AppMode } from "@/lib/context/AppModeContext";
import {
  PUBLIC_MECKY_CHAT_REQUEST_SCHEMA,
  parsePublicMeckyChatResponse,
  publicMeckyRefusalText,
  type PublicMeckyChatContext,
  type PublicMeckyEvidenceRef,
} from "@/lib/public-mecky-chat";
import { useUserProfile } from "@/hooks/useUserProfile";
import { isOrgAccount } from "@/types/account";

const MODE_GREETINGS: Record<AppMode, string> = {
  tourist:
    "Moin! 👋 Ich bin Mecky. Ich antworte aus geprüften öffentlichen Röbel-Quellen und sage offen, wenn dazu noch nichts Belastbares vorliegt.",
  citizen:
    "Moin! 👋 Ich bin Mecky, dein KI-Bürgerassistent. Ich ordne geprüfte Beiträge, lokale Nachrichten, Ratsunterlagen und Civic Cases ein – ohne selbst zu entscheiden.",
  org:
    "Moin! 👋 Ich bin Mecky. Ich helfe bei lokalen Fragen aus geprüften öffentlichen Quellen; geschäftliche oder amtliche Entscheidungen treffe ich nicht.",
};

const QUICK_PROMPTS: Record<AppMode, string[]> = {
  tourist: [
    "Welche geprüften Informationen gibt es zur Marienfelder Straße?",
    "Welche aktuellen Röbel-Themen sind öffentlich dokumentiert?",
    "Was ist bei den Quellen noch unklar?",
  ],
  citizen: [
    "Was ist der geprüfte Stand zur Marienfelder Straße?",
    "Gibt es offizielle Unterlagen zu einem offenen Treffpunkt in Röbel?",
    "Welche Themen warten noch auf Verwaltungsfeedback?",
  ],
  org: [
    "Welche geprüften Stadt-Themen betreffen lokale Gewerbe?",
    "Welche offiziellen Quellen liegen zu aktuellen Vorhaben vor?",
    "Wo fehlen noch belastbare Informationen?",
  ],
};

type ChatMessage = Readonly<{
  id: string;
  role: "user" | "assistant";
  text: string;
  evidenceRefs?: readonly PublicMeckyEvidenceRef[];
}>;

function messageId(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `mecky-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function MeckyPage() {
  const { activeAccount } = useAccount();
  const { user } = useUserProfile();
  const scrollRef = useRef<HTMLDivElement>(null);
  const effectiveMode: AppMode = activeAccount && isOrgAccount(activeAccount)
    ? "org"
    : (user?.tier === "citizen" || user?.is_verified_citizen)
      ? "citizen"
      : "tourist";
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [context, setContext] = useState<{
    request: PublicMeckyChatContext;
    sources: readonly PublicMeckyEvidenceRef[];
  } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "greeting-tourist",
      role: "assistant",
      text: MODE_GREETINGS.tourist,
    },
  ]);

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setIsLoading(false);
    setContext(null);
    setMessages([{
      id: `greeting-${effectiveMode}`,
      role: "assistant",
      text: MODE_GREETINGS[effectiveMode],
    }]);
    return () => { requestRef.current?.abort(); requestRef.current = null; };
  }, [effectiveMode, activeAccount?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const sendQuestion = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setMessages((current) => [
      ...current,
      { id: messageId(), role: "user", text: trimmed },
    ]);
    setInput("");
    setIsLoading(true);
    try {
      const response = await fetch("/api/chat/mecky", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schemaVersion: PUBLIC_MECKY_CHAT_REQUEST_SCHEMA,
          question: trimmed,
          ...(context ? { context: context.request } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("public_mecky_chat_unavailable");
      const result = parsePublicMeckyChatResponse(await response.json());
      if (requestRef.current !== controller) return;
      if (result.status === "answered" && !context) {
        setContext({ request: { question: trimmed, evidenceIds: result.evidenceRefs.map(source => source.evidenceId) },
          sources: result.evidenceRefs });
      }
      setMessages((current) => [
        ...current,
        result.status === "answered"
          ? {
              id: messageId(),
              role: "assistant",
              text: result.content,
              evidenceRefs: result.evidenceRefs,
            }
          : {
              id: messageId(),
              role: "assistant",
              text: publicMeckyRefusalText(result.reason, result.diagnosticCode),
            },
      ]);
    } catch {
      if (requestRef.current !== controller) return;
      setMessages((current) => [
        ...current,
        {
          id: messageId(),
          role: "assistant",
          text: "Mecky oder die geprüften Quellen sind gerade nicht erreichbar. Bitte versuche es gleich noch einmal.",
        },
      ]);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsLoading(false);
      }
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void sendQuestion(input);
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-2xl flex-col">
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500">
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Mecky</h1>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            KI-Assistent · geprüfte öffentliche Quellen · keine amtliche Auskunft
          </p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}
          >
            <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
              message.role === "user"
                ? "bg-primary"
                : "bg-gradient-to-br from-amber-400 to-orange-500"
            }`}>
              {message.role === "user" ? (
                <User className="h-4 w-4 text-primary-foreground" />
              ) : (
                <Bot className="h-4 w-4 text-white" />
              )}
            </div>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
              message.role === "user"
                ? "rounded-tr-sm bg-primary text-primary-foreground"
                : "rounded-tl-sm border border-border bg-card text-foreground"
            }`}>
              <p className="whitespace-pre-wrap break-words">{meckyPresentation(message.text, message.evidenceRefs?.map(e => e.publicCaseUrl) ?? []).body}</p>
              {message.evidenceRefs?.length ? (
                <div className="mt-3 border-t border-border pt-2">
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">
                    Verwendete Quellen
                  </p>
                  <ul className="space-y-1">
                    {message.evidenceRefs.map((evidence, index) => (
                      <li key={evidence.evidenceId}>
                        <a
                          href={meckySourceHref(evidence.publicCaseUrl, evidence.title)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                        >
                          [{index + 1}] {evidence.title}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        ))}

        {isLoading ? (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3">
              <div className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:0.3s]" />
              </div>
            </div>
          </div>
        ) : null}

        {messages.length === 1 ? (
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS[effectiveMode].map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => void sendQuestion(prompt)}
                className="rounded-full border border-border bg-muted px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
              >
                {prompt}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="border-t border-border py-3 text-xs text-muted-foreground" aria-live="polite">
        {context ? <>
          <p className="font-semibold text-foreground">Rückfrage zu den zuletzt gewählten Quellen</p>
          <p className="mt-1">{context.sources.map(source => source.title).join(" · ")}</p>
          <p className="mt-1">Jede Antwort liest diese Quellen neu. Für ein anderes Thema beginne eine neue Frage.</p>
          <button type="button" disabled={isLoading} onClick={() => setContext(null)}
            className="mt-2 font-semibold text-primary underline disabled:opacity-50">Neue Frage / Thema wechseln</button>
        </> : <p>Neue Frage · Suche in den geprüften öffentlichen Quellen. Dieser Verlauf wird nicht im gemeinsamen Feed veröffentlicht.</p>}
      </div>

      <form
        id="mecky-form"
        onSubmit={handleSubmit}
        className="flex gap-2 border-t border-border pt-4"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          aria-label={context ? "Rückfrage an Mecky" : "Neue Frage an Mecky"}
          placeholder={context ? "Rückfrage zu diesen Quellen..." : "Frag Mecky aus geprüften Quellen..."}
          maxLength={2_000}
          className="flex-1 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={isLoading}
        />
        <button
          type="submit"
          aria-label="Frage senden"
          disabled={isLoading || !input.trim()}
          className="rounded-full bg-primary p-2.5 text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
