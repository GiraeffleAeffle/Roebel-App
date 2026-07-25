"use client";

/**
 * "Story mit Mecky" — org dashboard flow.
 *
 * One page, four states:
 *   1. INTERVIEW — chat with Mecky (useChat -> /api/mecky/story-chat)
 *   2. (generating) — POST /api/mecky/story-draft turns the transcript into
 *      a `blog_articles` draft (rendered as a loading sub-state of INTERVIEW)
 *   3. EDIT — rich text + cover + metadata (RichTextEditor, ImageUploadDropzone)
 *   4. PUBLISH — publishStory() confirmation + link to the live article
 *
 * Reuses the exact patterns from `app/app/mecky/page.tsx` (useChat +
 * DefaultChatTransport) and `dashboard/blog/new` + `dashboard/blog/[id]/edit`
 * (account/wallet wiring, RichTextEditor, ImageUploadDropzone, dashboard
 * styling).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useActiveAccount } from "thirdweb/react";
import { useAccount } from "@/lib/context/AccountContext";
import type { OrgSubType } from "@/types/account";
import {
  startStoryConversation,
  getStoryDraftArticle,
  publishStory,
} from "@/app/actions/story";
import { updateBlogArticle } from "@/app/actions/blog";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { ImageUploadDropzone } from "@/components/ui/image-upload-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bot,
  User,
  Send,
  Sparkles,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Save,
  Rocket,
} from "lucide-react";
import { toast } from "sonner";

const CATEGORIES = [
  "Lokales",
  "Veranstaltungen",
  "Kultur",
  "Politik",
  "Wirtschaft",
  "Sport",
  "Vereinsleben",
];

const GREETING =
  "Moin! 👋 Ich bin Mecky. Erzähl mir eure Geschichte — wer seid ihr, was macht ihr, und was ist gerade neu? Aus unserem Gespräch schreibe ich euch danach einen Artikelentwurf für die Röbel-Community.";

// Mirrors `createStoryDraft`'s default `minUserTurns` in lib/story/draft.ts —
// kept in sync manually so the button doesn't enable before the server would
// actually accept the draft request.
const MIN_USER_TURNS = 2;

type Flow = "interview" | "edit" | "published";

interface DraftForm {
  title: string;
  excerpt: string;
  content: string;
  cover_image_url: string;
  category: string;
  tags: string;
}

const EMPTY_FORM: DraftForm = {
  title: "",
  excerpt: "",
  content: "",
  cover_image_url: "",
  category: "",
  tags: "",
};

export default function StoriesWithMeckyPage() {
  const { activeAccount } = useAccount();
  const wallet = useActiveAccount();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const startingRef = useRef(false);
  // Bumped by the "Erneut versuchen" button to force the conversation-start
  // effect below to re-run after a failed attempt (activeAccount/wallet/
  // conversationId alone don't change on retry, so the effect wouldn't
  // otherwise fire again).
  const [retryToken, setRetryToken] = useState(0);

  const [flow, setFlow] = useState<Flow>("interview");
  const [articleId, setArticleId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeAccount || !wallet?.address) return;
    if (conversationId || startingRef.current) return;
    startingRef.current = true;
    startStoryConversation(activeAccount.id, wallet.address).then((res) => {
      startingRef.current = false;
      if (res.success && res.conversationId) {
        setConversationId(res.conversationId);
      } else {
        setStartError(res.error ?? "Interview konnte nicht gestartet werden");
      }
    });
  }, [activeAccount, wallet?.address, conversationId, retryToken]);

  if (!activeAccount || !wallet?.address) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <div className="w-12 h-12 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
          <Bot className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">
          Anmeldung erforderlich
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Verbinde dein Wallet und wähle eine Organisation, um mit Mecky eure
          Geschichte zu erzählen.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-medium flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Story mit Mecky
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Erzähl Mecky eure Geschichte im Chat — Mecky schreibt daraus einen
          Artikelentwurf, den ihr bearbeiten und veröffentlichen könnt.
        </p>
      </div>

      {flow === "interview" && startError && (
        <div className="bg-card border border-border rounded-[10px] p-10 text-center space-y-3">
          <p className="text-sm text-red-600 dark:text-red-400">{startError}</p>
          <Button
            variant="outline"
            onClick={() => {
              setStartError(null);
              startingRef.current = false;
              setRetryToken((t) => t + 1);
            }}
          >
            Erneut versuchen
          </Button>
        </div>
      )}

      {flow === "interview" && !startError && !conversationId && (
        <div className="bg-card border border-border rounded-[10px] p-10 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Mecky bereitet das Interview vor …
          </p>
        </div>
      )}

      {flow === "interview" && conversationId && (
        <InterviewPanel
          conversationId={conversationId}
          accountId={activeAccount.id}
          accountName={activeAccount.name}
          accountSubType={activeAccount.sub_type}
          walletAddress={wallet.address}
          onDraftReady={(id) => {
            setArticleId(id);
            setFlow("edit");
          }}
        />
      )}

      {flow === "edit" && articleId && (
        <EditPanel
          articleId={articleId}
          conversationId={conversationId as string}
          accountId={activeAccount.id}
          walletAddress={wallet.address}
          onPublished={() => setFlow("published")}
        />
      )}

      {flow === "published" && articleId && (
        <PublishedPanel articleId={articleId} />
      )}
    </div>
  );
}

function InterviewPanel({
  conversationId,
  accountId,
  accountName,
  accountSubType,
  walletAddress,
  onDraftReady,
}: {
  conversationId: string;
  accountId: string;
  accountName: string;
  accountSubType: OrgSubType | null;
  walletAddress: string;
  onDraftReady: (articleId: string) => void;
}) {
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // conversationId is stable for the lifetime of this component (parent only
  // mounts it once the conversation exists), so it's safe to bake it into the
  // transport once — useChat's underlying Chat instance is created on first
  // render and does NOT pick up later `transport` prop changes.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/mecky/story-chat",
        body: { conversationId, walletAddress },
      }),
    [conversationId, walletAddress]
  );

  const { messages, sendMessage, status } = useChat({
    transport,
    messages: [
      {
        id: "greeting",
        role: "assistant",
        parts: [{ type: "text" as const, text: GREETING }],
      },
    ] as UIMessage[],
  });

  const isLoading = status !== "ready";
  const userTurns = messages.filter((m) => m.role === "user").length;
  const canGenerate = userTurns >= MIN_USER_TURNS && !isLoading && !generating;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput("");
  };

  const handleGenerate = async () => {
    setGenerating(true);
    const t = toast.loading("Mecky schreibt euren Artikel …");
    try {
      const res = await fetch("/api/mecky/story-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          subject: {
            kind: "other",
            name: accountName,
            sub_type: accountSubType ?? undefined,
          },
          accountId,
          authorAccountId: accountId,
          walletAddress,
        }),
      });
      const data: {
        success: boolean;
        articleId?: string;
        slug?: string;
        error?: string;
      } = await res.json();
      if (data.success && data.articleId) {
        toast.success("Artikel erstellt", { id: t });
        onDraftReady(data.articleId);
      } else {
        toast.error("Fehler beim Erstellen des Artikels", {
          id: t,
          description: data.error,
        });
        setGenerating(false);
      }
    } catch (err) {
      toast.error("Fehler beim Erstellen des Artikels", {
        id: t,
        description: err instanceof Error ? err.message : undefined,
      });
      setGenerating(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-[10px] flex flex-col h-[60vh]">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
          <Bot className="h-4 w-4 text-white" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Mecky</p>
          <p className="text-xs text-muted-foreground">
            Erzählt eure Geschichte im Chat
          </p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === "user" ? "flex-row-reverse" : ""}`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                message.role === "user"
                  ? "bg-primary"
                  : "bg-gradient-to-br from-amber-400 to-orange-500"
              }`}
            >
              {message.role === "user" ? (
                <User className="h-4 w-4 text-primary-foreground" />
              ) : (
                <Bot className="h-4 w-4 text-white" />
              )}
            </div>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                message.role === "user"
                  ? "bg-primary text-primary-foreground rounded-tr-sm"
                  : "bg-muted text-foreground rounded-tl-sm"
              }`}
            >
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
            <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0.15s]" />
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce [animation-delay:0.3s]" />
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-2 px-4 py-3 border-t border-border">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Antworte Mecky …"
          className="flex-1 px-4 py-2.5 bg-background border border-border rounded-full text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={isLoading || generating}
        />
        <button
          type="submit"
          disabled={isLoading || generating || !input.trim()}
          className="p-2.5 bg-primary hover:bg-primary/90 disabled:bg-muted text-primary-foreground disabled:text-muted-foreground rounded-full transition-colors"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>

      <div className="px-4 pb-4">
        <Button onClick={handleGenerate} disabled={!canGenerate} className="w-full">
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Mecky schreibt euren Artikel …
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Artikel schreiben
            </>
          )}
        </Button>
        {!canGenerate && !generating && (
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Erzählt Mecky noch ein bisschen mehr, dann kann der Artikel
            geschrieben werden.
          </p>
        )}
      </div>
    </div>
  );
}

function EditPanel({
  articleId,
  conversationId,
  accountId,
  walletAddress,
  onPublished,
}: {
  articleId: string;
  conversationId: string;
  accountId: string;
  walletAddress: string;
  onPublished: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getStoryDraftArticle(conversationId, walletAddress).then((res) => {
      if (cancelled) return;
      if (res.success && res.article) {
        const a = res.article;
        setForm({
          title: typeof a.title === "string" ? a.title : "",
          excerpt: typeof a.excerpt === "string" ? a.excerpt : "",
          content: typeof a.content === "string" ? a.content : "",
          cover_image_url:
            typeof a.cover_image_url === "string" ? a.cover_image_url : "",
          category: typeof a.category === "string" ? a.category : "",
          tags: Array.isArray(a.tags) ? (a.tags as string[]).join(", ") : "",
        });
      } else {
        setLoadError(res.error ?? "Entwurf konnte nicht geladen werden");
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, walletAddress]);

  const buildFormData = (status: "draft" | "published") => {
    const fd = new FormData();
    fd.set("account_id", accountId);
    fd.set("wallet_address", walletAddress);
    fd.set("title", form.title);
    fd.set("excerpt", form.excerpt);
    fd.set("content", form.content);
    fd.set("cover_image_url", form.cover_image_url);
    fd.set("category", form.category);
    fd.set("tags", form.tags);
    fd.set("status", status);
    return fd;
  };

  const handleSave = async () => {
    setSaving(true);
    const t = toast.loading("Wird gespeichert …");
    const res = await updateBlogArticle(articleId, buildFormData("draft"));
    if (res.success) {
      toast.success("Gespeichert", { id: t });
    } else {
      toast.error("Fehler", { id: t, description: res.error });
    }
    setSaving(false);
  };

  const handlePublish = async () => {
    setPublishing(true);
    const t = toast.loading("Wird veröffentlicht …");
    // Persist the latest edits first so publish never ships a stale draft —
    // updateBlogArticle keeps status "draft" here, publishStory below is what
    // actually flips it to "published" (+ teaser post + notification).
    const saveRes = await updateBlogArticle(articleId, buildFormData("draft"));
    if (!saveRes.success) {
      toast.error("Fehler beim Speichern", {
        id: t,
        description: saveRes.error,
      });
      setPublishing(false);
      return;
    }
    const pubRes = await publishStory(articleId, accountId, walletAddress);
    if (pubRes.success) {
      toast.success("Veröffentlicht", { id: t });
      onPublished();
    } else {
      toast.error("Fehler", { id: t, description: pubRes.error });
    }
    setPublishing(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-card border border-border rounded-[10px] p-10 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-[10px] p-6 space-y-6">
        <div>
          <Label htmlFor="title">Titel *</Label>
          <Input
            id="title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="excerpt">Kurzbeschreibung</Label>
          <Textarea
            id="excerpt"
            value={form.excerpt}
            onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
            rows={3}
            className="mt-1"
          />
        </div>
        <div>
          <Label>Titelbild</Label>
          <div className="mt-2">
            <ImageUploadDropzone
              bucketName="blog-images"
              currentImageUrl={form.cover_image_url}
              onUploadComplete={(url) =>
                setForm({ ...form, cover_image_url: url })
              }
              maxSizeMB={5}
            />
          </div>
        </div>
        <div>
          <Label>Inhalt *</Label>
          <div className="mt-2">
            <RichTextEditor
              content={form.content}
              onChange={(content) => setForm({ ...form, content })}
              bucket="blog-images"
              placeholder="Von Mecky vorbereiteter Entwurf — hier bearbeiten …"
            />
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-[10px] p-6 space-y-6">
        <h3 className="font-medium text-lg">Metadaten</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <Label htmlFor="category">Kategorie</Label>
            <Select
              value={form.category}
              onValueChange={(value) => setForm({ ...form, category: value })}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Kategorie wählen" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="tags">Tags (kommagetrennt)</Label>
            <Input
              id="tags"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="Tag1, Tag2"
              className="mt-1"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 justify-end">
        <Button
          variant="outline"
          onClick={handleSave}
          disabled={saving || publishing || !form.title || !form.content}
        >
          <Save className="h-4 w-4 mr-2" />
          Speichern
        </Button>
        <Button
          onClick={handlePublish}
          disabled={saving || publishing || !form.title || !form.content}
        >
          {publishing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Rocket className="h-4 w-4 mr-2" />
          )}
          Veröffentlichen
        </Button>
      </div>
    </div>
  );
}

function PublishedPanel({ articleId }: { articleId: string }) {
  return (
    <div className="bg-card border border-border rounded-[10px] p-10 text-center space-y-4">
      <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 mx-auto flex items-center justify-center">
        <CheckCircle2 className="h-7 w-7 text-green-600 dark:text-green-400" />
      </div>
      <div>
        <h2 className="text-lg font-medium text-foreground">Veröffentlicht!</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Eure Geschichte ist jetzt für die Röbel-Community sichtbar.
        </p>
      </div>
      <div className="flex items-center justify-center gap-3">
        <Button asChild>
          <Link href={`/app/blog/${articleId}`} target="_blank">
            <ExternalLink className="h-4 w-4 mr-2" />
            Artikel ansehen
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dashboard/blog">Zur Blog-Übersicht</Link>
        </Button>
      </div>
    </div>
  );
}
