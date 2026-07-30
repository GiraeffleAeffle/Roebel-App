"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useState, useRef, useEffect, useMemo } from "react";
import { useAppMode } from "@/lib/context/AppModeContext";
import { useAccount } from "@/lib/context/AccountContext";
import { useUserProfile } from "@/hooks/useUserProfile";
import { isOrgAccount } from "@/types/account";
import { Send, Bot, User, Sparkles, RefreshCw } from "lucide-react";
import type { AppMode } from "@/lib/context/AppModeContext";

const MODE_GREETINGS: Record<AppMode, string> = {
  tourist: "Moin! 👋 Ich bin Mecky, eine künstliche Intelligenz und dein Stadtführer für Röbel. Frag mich nach Restaurants, Events, Sehenswürdigkeiten oder was du sonst wissen möchtest!",
  citizen: "Moin! 👋 Ich bin Mecky, eine künstliche Intelligenz und dein Bürgerassistent. Frag mich zu Abstimmungen, Community-Themen oder was gerade in Röbel los ist!",
  org: "Moin! 👋 Ich bin Mecky, eine künstliche Intelligenz und dein Business-Berater. Frag mich zum Röbel Card Partnerprogramm, Marketing-Tipps oder wie du dein Gewerbe in der App am besten präsentierst!",
};

const QUICK_PROMPTS: Record<AppMode, string[]> = {
  tourist: [
    "Was kann ich heute in Röbel machen?",
    "Welche Restaurants empfiehlst du?",
    "Erzähl mir über die Müritz",
    "Gibt es heute Events?",
  ],
  citizen: [
    "Welche Abstimmungen sind aktiv?",
    "Wie funktioniert die Röbel Card?",
    "Was gibt's Neues im Marktplatz?",
    "Wie kann ich mich verifizieren?",
  ],
  org: [
    "Wie werde ich Röbel Card Partner?",
    "Tipps für mehr Reichweite",
    "Wie erstelle ich ein Angebot?",
    "Was bringt die Stempelkarte?",
  ],
};

export default function MeckyPage() {
  const { activeMode } = useAppMode();
  const { activeAccount } = useAccount();
  const { user } = useUserProfile();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Derive effective mode from account type for Mecky context
  const effectiveMode: AppMode = activeAccount && isOrgAccount(activeAccount)
    ? "org"
    : (user?.tier === "citizen" || user?.is_verified_citizen)
      ? "citizen"
      : "tourist";

  const [input, setInput] = useState("");

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat/mecky", body: { mode: effectiveMode } }),
    [effectiveMode]
  );

  const { messages, sendMessage, status } = useChat({
    transport,
    messages: [
      {
        id: "greeting",
        role: "assistant",
        parts: [{ type: "text" as const, text: MODE_GREETINGS[effectiveMode] }],
      },
    ] as UIMessage[],
  });

  const isLoading = status !== "ready";

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleQuickPrompt = (prompt: string) => {
    sendMessage({ text: prompt });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput("");
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-border">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Mecky</h1>
          {/* AI Act Art. 50(1): permanently visible KI disclosure in the chat itself */}
          <p className="text-xs text-muted-foreground">
            {effectiveMode === "tourist" ? "Dein Stadtführer" :
             effectiveMode === "citizen" ? "Dein Bürgerassistent" :
             "Dein Business-Berater"}
            {" · KI-Assistent"}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
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
                ? "bg-primary text-primary-foreground rounded-tr-sm"
                : "bg-card border border-border text-foreground rounded-tl-sm"
            }`}>
              <p className="whitespace-pre-wrap">
                {message.parts
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("")}
              </p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0.15s]" />
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0.3s]" />
              </div>
            </div>
          </div>
        )}

        {/* Quick prompts — only show when few messages */}
        {messages.length <= 1 && (
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS[effectiveMode].map((prompt) => (
              <button
                key={prompt}
                onClick={() => handleQuickPrompt(prompt)}
                className="px-3 py-1.5 bg-muted hover:bg-accent text-sm text-foreground rounded-full border border-border transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <form
        id="mecky-form"
        onSubmit={handleSubmit}
        className="flex gap-2 pt-4 border-t border-border"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Frag Mecky..."
          className="flex-1 px-4 py-2.5 bg-card border border-border rounded-full text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="p-2.5 bg-primary hover:bg-primary/90 disabled:bg-muted text-primary-foreground disabled:text-muted-foreground rounded-full transition-colors"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
