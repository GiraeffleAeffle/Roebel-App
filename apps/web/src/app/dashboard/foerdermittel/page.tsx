"use client";

/**
 * "Fördermittel" — org dashboard panel. The pull complement to Mecky's
 * proactive funding outreach (see the Fördermittel Agent spec).
 *
 * Flow on one page:
 *   1. Förderprofil — an editable form (legal form, gemeinnützig, sectors, the
 *      project narrative). Saving recomputes completeness server-side.
 *   2. Förderabgleich — runs the (existing, dormant) matching engine:
 *      hard filters + Opus deep-fit → persisted `org_funding_matches`.
 *   3. Honest report — matches grouped by probability band, `niedrig` collapsed
 *      (never hidden), each with rationale + requirements + source link, plus a
 *      visible "Mecky kann sich irren" disclaimer. Save / dismiss / ask-for-help.
 *   4. Opt-out toggle for proactive outreach.
 *
 * Wallet/account wiring + dashboard styling mirror `dashboard/stories/page.tsx`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { useAccount } from "@/lib/context/AccountContext";
import {
  getFundingProfile,
  saveFundingProfile,
  getFundingMatches,
  updateFundingMatchStatus,
  getFoerderOutreachOptIn,
  setFoerderOutreachOptIn,
  runFundingMatchAction,
} from "@/app/actions/foerdermittel";
import {
  emptyProfileForm,
  profileToForm,
  computeCompleteness,
  LEGAL_FORM_OPTIONS,
  LEGAL_FORM_LABELS,
  BUDGET_BAND_OPTIONS,
  BUDGET_BAND_LABELS,
  SECTOR_TAG_OPTIONS,
  type ProfileFormInput,
} from "@/lib/foerdermittel/profile";
import type { FundingMatchView, ProbabilityBand, MatchStatus } from "@/types/foerdermittel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Landmark,
  Loader2,
  Sparkles,
  ExternalLink,
  Bookmark,
  BookmarkCheck,
  X,
  AlertTriangle,
  Info,
  HandHelping,
} from "lucide-react";
import { toast } from "sonner";

const BAND_LABEL: Record<ProbabilityBand, string> = {
  hoch: "Gute Chance",
  mittel: "Mittlere Chance",
  niedrig: "Geringe Chance",
};
const BAND_CLASS: Record<ProbabilityBand, string> = {
  hoch: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  mittel: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  niedrig: "bg-muted text-muted-foreground",
};

function gemToSelect(v: boolean | null): "ja" | "nein" | "unbekannt" {
  if (v === true) return "ja";
  if (v === false) return "nein";
  return "unbekannt";
}
function selectToGem(v: string): boolean | null {
  if (v === "ja") return true;
  if (v === "nein") return false;
  return null;
}

function formatEuro(n: number): string {
  return n.toLocaleString("de-DE", { maximumFractionDigits: 0 });
}
function amountLabel(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${formatEuro(min)} – ${formatEuro(max)} €`;
  if (max != null) return `bis ${formatEuro(max)} €`;
  return `ab ${formatEuro(min as number)} €`;
}
function formatDeadline(d: string | null): string | null {
  if (!d) return null;
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
}

export default function FoerdermittelPage() {
  const { activeAccount } = useAccount();
  const wallet = useActiveAccount();
  const walletAddress = wallet?.address ?? null;

  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ProfileFormInput>(emptyProfileForm());
  const [savedCompleteness, setSavedCompleteness] = useState(0);
  const [saving, setSaving] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matches, setMatches] = useState<FundingMatchView[]>([]);
  const [optIn, setOptIn] = useState(true);
  const [showLowChance, setShowLowChance] = useState(false);

  const canUse = !!activeAccount && !!walletAddress;
  const liveCompleteness = useMemo(() => computeCompleteness(form), [form]);

  // Load profile + matches + opt-in on mount.
  useEffect(() => {
    if (!activeAccount || !walletAddress) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getFundingProfile(activeAccount.id, walletAddress),
      getFundingMatches(activeAccount.id, walletAddress),
      getFoerderOutreachOptIn(activeAccount.id, walletAddress),
    ])
      .then(([profileRes, matchRes, optInRes]) => {
        if (cancelled) return;
        if (profileRes.success && profileRes.profile) {
          setForm(profileToForm(profileRes.profile));
          setSavedCompleteness(profileRes.profile.profile_completeness ?? 0);
        }
        if (matchRes.success && matchRes.matches) setMatches(matchRes.matches);
        if (optInRes.success && typeof optInRes.optIn === "boolean") setOptIn(optInRes.optIn);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeAccount, walletAddress]);

  const patch = useCallback((p: Partial<ProfileFormInput>) => {
    setForm((f) => ({ ...f, ...p }));
  }, []);

  const toggleSector = useCallback((value: string) => {
    setForm((f) => ({
      ...f,
      sector_tags: f.sector_tags.includes(value)
        ? f.sector_tags.filter((t) => t !== value)
        : [...f.sector_tags, value],
    }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!activeAccount || !walletAddress) return;
    setSaving(true);
    const res = await saveFundingProfile(activeAccount.id, walletAddress, form);
    setSaving(false);
    if (!res.success || !res.profile) {
      toast.error(res.error ?? "Speichern fehlgeschlagen");
      return;
    }
    setSavedCompleteness(res.profile.profile_completeness ?? 0);
    toast.success("Förderprofil gespeichert");
  }, [activeAccount, walletAddress, form]);

  const handleMatch = useCallback(async () => {
    if (!activeAccount || !walletAddress) return;
    // Save first so the engine reads the latest profile, then match.
    setMatching(true);
    const saveRes = await saveFundingProfile(activeAccount.id, walletAddress, form);
    if (!saveRes.success) {
      setMatching(false);
      toast.error(saveRes.error ?? "Speichern fehlgeschlagen");
      return;
    }
    setSavedCompleteness(saveRes.profile?.profile_completeness ?? 0);
    const res = await runFundingMatchAction(activeAccount.id, walletAddress);
    if (!res.success) {
      setMatching(false);
      toast.error(res.error ?? "Abgleich fehlgeschlagen");
      return;
    }
    const fresh = await getFundingMatches(activeAccount.id, walletAddress);
    setMatching(false);
    if (fresh.success && fresh.matches) {
      setMatches(fresh.matches);
      toast.success(
        fresh.matches.length > 0
          ? `${fresh.matches.length} passende Programme gefunden`
          : "Aktuell keine passenden Programme gefunden",
      );
    }
  }, [activeAccount, walletAddress, form]);

  const changeMatchStatus = useCallback(
    async (matchId: string, status: MatchStatus) => {
      if (!activeAccount || !walletAddress) return;
      // Optimistic: dismissed disappears; others update in place.
      setMatches((prev) =>
        status === "dismissed"
          ? prev.filter((m) => m.id !== matchId)
          : prev.map((m) => (m.id === matchId ? { ...m, status } : m)),
      );
      const res = await updateFundingMatchStatus(activeAccount.id, walletAddress, matchId, status);
      if (!res.success) {
        toast.error(res.error ?? "Status konnte nicht gespeichert werden");
        // Reload to resync on failure.
        const fresh = await getFundingMatches(activeAccount.id, walletAddress);
        if (fresh.success && fresh.matches) setMatches(fresh.matches);
        return;
      }
      if (status === "saved") toast.success("Gemerkt");
      if (status === "dismissed") toast.success("Verworfen");
      if (status === "applying") toast.success("Mecky wurde informiert — wir melden uns beim Antrag.");
    },
    [activeAccount, walletAddress],
  );

  const handleOptInChange = useCallback(
    async (next: boolean) => {
      if (!activeAccount || !walletAddress) return;
      setOptIn(next);
      const res = await setFoerderOutreachOptIn(activeAccount.id, walletAddress, next);
      if (!res.success) {
        setOptIn(!next);
        toast.error(res.error ?? "Einstellung konnte nicht gespeichert werden");
      }
    },
    [activeAccount, walletAddress],
  );

  if (!canUse) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <div className="w-12 h-12 rounded-full bg-muted mx-auto mb-4 flex items-center justify-center">
          <Landmark className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">Anmeldung erforderlich</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Verbinde dein Wallet und wähle eine Organisation, um passende Fördermittel zu finden.
        </p>
      </div>
    );
  }

  const visibleMatches = showLowChance ? matches : matches.filter((m) => !m.collapsed);
  const lowChanceCount = matches.filter((m) => m.collapsed).length;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-medium flex items-center gap-2">
          <Landmark className="h-5 w-5 text-primary" />
          Fördermittel
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Mecky sucht ehrlich nach Förderprogrammen, die wirklich zu euch passen — mit realistischer
          Einschätzung, nicht als Auflistung von allem.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Lädt…
        </div>
      ) : (
        <>
          {/* Profile form */}
          <div className="bg-card border border-border rounded-[10px] p-5 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-base font-medium">Förderprofil</h2>
              <span className="text-xs text-muted-foreground">
                Vollständigkeit: {liveCompleteness}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${liveCompleteness}%` }}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Rechtsform</Label>
                <Select value={form.legal_form} onValueChange={(v) => patch({ legal_form: v as ProfileFormInput["legal_form"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEGAL_FORM_OPTIONS.map((lf) => (
                      <SelectItem key={lf} value={lf}>{LEGAL_FORM_LABELS[lf]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Gemeinnützig?</Label>
                <Select value={gemToSelect(form.is_gemeinnuetzig)} onValueChange={(v) => patch({ is_gemeinnuetzig: selectToGem(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ja">Ja</SelectItem>
                    <SelectItem value="nein">Nein</SelectItem>
                    <SelectItem value="unbekannt">Unbekannt</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Gegründet (Jahr)</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="z. B. 1998"
                  value={form.founded_year ?? ""}
                  onChange={(e) => patch({ founded_year: e.target.value ? Number(e.target.value) : null })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Mitglieder / Mitarbeitende</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="z. B. 42"
                  value={form.member_count ?? ""}
                  onChange={(e) => patch({ member_count: e.target.value ? Number(e.target.value) : null })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Jahresbudget</Label>
                <Select value={form.budget_band} onValueChange={(v) => patch({ budget_band: v as ProfileFormInput["budget_band"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BUDGET_BAND_OPTIONS.map((b) => (
                      <SelectItem key={b} value={b}>{BUDGET_BAND_LABELS[b]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Region</Label>
                <Input
                  value={form.region}
                  onChange={(e) => patch({ region: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Themenfelder</Label>
              <div className="flex flex-wrap gap-2">
                {SECTOR_TAG_OPTIONS.map((t) => {
                  const active = form.sector_tags.includes(t.value);
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => toggleSector(t.value)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-transparent text-muted-foreground border-border hover:border-primary/50"
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Was habt ihr vor? Welche Förderung braucht ihr?</Label>
              <Textarea
                rows={4}
                placeholder="Beschreibt euer konkretes Projekt oder Vorhaben — je konkreter, desto ehrlicher kann Mecky einschätzen. z. B. „Wir möchten unseren Vereinsraum barrierefrei umbauen und dafür einen Aufzug einbauen.“"
                value={form.project_needs}
                onChange={(e) => patch({ project_needs: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Ziele (optional)</Label>
              <Textarea
                rows={2}
                placeholder="Was wollt ihr damit erreichen?"
                value={form.goals}
                onChange={(e) => patch({ goals: e.target.value })}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button variant="outline" onClick={handleSave} disabled={saving || matching}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Profil speichern
              </Button>
              <Button onClick={handleMatch} disabled={matching || saving}>
                {matching ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Förderabgleich starten
              </Button>
              {liveCompleteness < 40 && (
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  Für einen Abgleich braucht Mecky mindestens euer Vorhaben + Rechtsform.
                </span>
              )}
            </div>
          </div>

          {/* Report */}
          {matches.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 border border-border rounded-[10px] p-3">
                <Info className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Mecky kann sich irren — bitte prüft die Förderbedingungen immer selbst über die
                  verlinkte Quelle.
                </span>
              </div>

              {visibleMatches.map((m) => (
                <MatchCard key={m.id} match={m} onStatus={changeMatchStatus} />
              ))}

              {lowChanceCount > 0 && !showLowChance && (
                <Button variant="ghost" size="sm" onClick={() => setShowLowChance(true)}>
                  {lowChanceCount} Programme mit geringer Chance anzeigen
                </Button>
              )}
            </div>
          )}

          {/* Opt-out */}
          <div className="bg-card border border-border rounded-[10px] p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Proaktive Hinweise von Mecky</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Mecky darf sich bei euch melden, wenn es passende neue Fördermittel gibt.
              </p>
            </div>
            <Switch checked={optIn} onCheckedChange={handleOptInChange} />
          </div>
        </>
      )}
    </div>
  );
}

function MatchCard({
  match: m,
  onStatus,
}: {
  match: FundingMatchView;
  onStatus: (matchId: string, status: MatchStatus) => void;
}) {
  const amount = amountLabel(m.amount_min, m.amount_max);
  const deadline = formatDeadline(m.deadline);
  const saved = m.status === "saved" || m.status === "applying";
  const applying = m.status === "applying";

  return (
    <div className="bg-card border border-border rounded-[10px] p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-medium leading-snug">{m.program_name}</h3>
          {m.provider && <p className="text-xs text-muted-foreground mt-0.5">{m.provider}</p>}
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full whitespace-nowrap ${BAND_CLASS[m.probability_band]}`}>
          {BAND_LABEL[m.probability_band]}
        </span>
      </div>

      {(amount || deadline) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {amount && <span>💶 {amount}</span>}
          {deadline && <span>📅 Frist: {deadline}</span>}
        </div>
      )}

      {m.rationale && <p className="text-sm text-foreground/90 leading-relaxed">{m.rationale}</p>}

      {m.requirements && (
        <div className="text-sm">
          <span className="font-medium">Voraussetzungen: </span>
          <span className="text-foreground/80">{m.requirements}</span>
        </div>
      )}

      {m.red_flags && (
        <div className="flex items-start gap-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{m.red_flags}</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {m.source_url && (
          <a
            href={m.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Zur Förderquelle
          </a>
        )}
        <div className="flex-1" />
        <Button
          variant={saved ? "secondary" : "outline"}
          size="sm"
          onClick={() => onStatus(m.id, saved ? "seen" : "saved")}
        >
          {saved ? <BookmarkCheck className="h-4 w-4 mr-1.5" /> : <Bookmark className="h-4 w-4 mr-1.5" />}
          {saved ? "Gemerkt" : "Merken"}
        </Button>
        <Button
          variant={applying ? "secondary" : "outline"}
          size="sm"
          disabled={applying}
          onClick={() => onStatus(m.id, "applying")}
        >
          <HandHelping className="h-4 w-4 mr-1.5" />
          {applying ? "Mecky hilft" : "Beim Antrag helfen"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onStatus(m.id, "dismissed")}>
          <X className="h-4 w-4 mr-1.5" /> Verwerfen
        </Button>
      </div>
    </div>
  );
}
