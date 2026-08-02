"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Leaf, Sprout } from "lucide-react";

import { MenuItemThumbs } from "@/components/org/MenuItemThumbs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useMenuItemVote } from "@/hooks/useMenuItemVote";
import {
  fetchMenuItemDetail,
  fetchRelatedMenuItems,
  type MenuItemDetail,
} from "@/lib/supabase-gastro";
import { formatPrice } from "@/types/restaurant";
import type { MenuItem } from "@/types/restaurant";

export function MenuItemClient({
  slug,
  itemId,
}: {
  slug: string;
  itemId: string;
}) {
  const router = useRouter();
  const [item, setItem] = useState<MenuItemDetail | null>(null);
  const [related, setRelated] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { summary, userVote, isSignedIn, setVote, clearVote } =
    useMenuItemVote(itemId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const detail = await fetchMenuItemDetail(itemId, slug);
      if (cancelled) return;
      setItem(detail);
      setLoading(false);
      if (detail) {
        const rel = await fetchRelatedMenuItems(detail.restaurant_id, itemId, 6);
        if (!cancelled) setRelated(rel);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (loading) {
    return (
      <div className="space-y-4 pb-10">
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-muted-foreground">Gericht nicht gefunden.</p>
        <button
          onClick={() => router.back()}
          className="mt-3 text-sm font-medium text-primary hover:underline"
        >
          Zurück
        </button>
      </div>
    );
  }

  return (
    <div className="pb-10">
      {/* Hero */}
      <div className="relative h-64 w-full overflow-hidden rounded-2xl bg-muted">
        {item.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image_url}
            alt={item.name}
            className="h-full w-full object-cover"
          />
        )}
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Zurück"
          className="absolute left-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-background/90 shadow-sm backdrop-blur hover:bg-background"
        >
          <ChevronLeft size={22} className="text-foreground" />
        </button>
      </div>

      {/* Title + price */}
      <div className="mt-4 space-y-3 px-1">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold text-foreground">{item.name}</h1>
          <span className="whitespace-nowrap text-xl font-medium text-foreground">
            {item.has_variants ? "ab " : ""}
            {formatPrice(item.price)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {item.is_vegetarian && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Leaf size={12} /> Vegetarisch
            </Badge>
          )}
          {item.is_vegan && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Sprout size={12} /> Vegan
            </Badge>
          )}
        </div>

        {/* Vote */}
        <div className="pt-1">
          <MenuItemThumbs
            summary={summary}
            size="md"
            interactive
            userVote={userVote}
            onVote={(v) => {
              if (!isSignedIn) return;
              if (userVote === v) clearVote();
              else setVote(v);
            }}
          />
          {!isSignedIn && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Melde dich an, um zu bewerten.
            </p>
          )}
        </div>

        {item.description && (
          <p className="text-[15px] leading-relaxed text-foreground">
            {item.description}
          </p>
        )}
      </div>

      {/* Variants */}
      {item.variants.length > 0 && (
        <div className="mt-6 border-t border-border px-1 pt-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">
            {item.variants_label || "Variante wählen"}
          </h2>
          <div className="space-y-2">
            {item.variants.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
              >
                <span className="text-sm text-foreground">
                  {v.name}
                  {v.is_default && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      Standard
                    </span>
                  )}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {formatPrice(v.price)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sides */}
      {item.sides.length > 0 && (
        <div className="mt-6 border-t border-border px-1 pt-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">
            {item.sides_label || "Beilagen"}
            {item.sides_required && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                erforderlich
              </span>
            )}
          </h2>
          <div className="space-y-2">
            {item.sides.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3"
              >
                <div>
                  <span className="text-sm text-foreground">{s.name}</span>
                  {s.description && (
                    <p className="text-xs text-muted-foreground">
                      {s.description}
                    </p>
                  )}
                </div>
                {s.price_delta > 0 && (
                  <span className="text-sm font-medium text-foreground">
                    + {formatPrice(s.price_delta)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Related */}
      {related.length > 0 && (
        <div className="mt-6 border-t border-border px-1 pt-5">
          <h2 className="mb-3 text-base font-semibold text-foreground">
            Häufig zusammen gekauft
          </h2>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none">
            {related.map((r) => (
              <Link
                key={r.id}
                href={`/app/orgs/${slug}/menu/${r.id}`}
                className="w-36 flex-shrink-0 overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="aspect-square w-full bg-muted">
                  {r.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.image_url}
                      alt={r.name}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="space-y-1 p-2.5">
                  <p className="line-clamp-1 text-sm font-medium text-foreground">
                    {r.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatPrice(r.price)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
