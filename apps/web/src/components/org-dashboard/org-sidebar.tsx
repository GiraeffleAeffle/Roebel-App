"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  UserCog,
  FileText,
  Users,
  Clock,
  Package,
  Tag,
  Calendar,
  CreditCard,
  Settings,
  UtensilsCrossed,
  BookOpen,
  Vote,
  ExternalLink,
  LayoutGrid,
  Sparkles,
  Landmark,
  Image as ImageIcon,
} from "lucide-react";
import {
  subTypeFeatures,
  SUB_TYPE_LABELS,
  SUB_TYPE_EMOJI,
} from "@/types/account";
import type { Account } from "@/types/account";

interface OrgSidebarProps {
  account: Account;
}

export function OrgSidebar({ account }: OrgSidebarProps) {
  const pathname = usePathname();
  const features = subTypeFeatures(account.sub_type);

  type Item = {
    name: string;
    href: string;
    icon: React.ReactNode;
    visible: boolean;
  };

  const items: Item[] = [
    {
      name: "Übersicht",
      href: "/dashboard",
      icon: <LayoutDashboard className="h-4 w-4" />,
      visible: true,
    },
    {
      name: "Profil",
      href: "/dashboard/profile",
      icon: <UserCog className="h-4 w-4" />,
      visible: true,
    },
    {
      name: "Blog",
      href: "/dashboard/blog",
      icon: <FileText className="h-4 w-4" />,
      visible: features.blog,
    },
    {
      name: "Story mit Mecky",
      href: "/dashboard/stories",
      icon: <Sparkles className="h-4 w-4" />,
      visible: features.blog,
    },
    {
      name: "Fördermittel",
      href: "/dashboard/foerdermittel",
      icon: <Landmark className="h-4 w-4" />,
      visible: features.foerdermittel,
    },
    {
      name: "Flyer",
      href: "/dashboard/flyer",
      icon: <ImageIcon className="h-4 w-4" />,
      visible: features.flyer,
    },
    {
      name: "Mitglieder",
      href: "/dashboard/members",
      icon: <Users className="h-4 w-4" />,
      visible: features.members,
    },
    {
      name: "Öffnungszeiten",
      href: "/dashboard/opening-hours",
      icon: <Clock className="h-4 w-4" />,
      visible: features.openingHours,
    },
    {
      name: "Speisekarte",
      href: "/dashboard/speisekarte",
      icon: <UtensilsCrossed className="h-4 w-4" />,
      visible: features.speisekarte,
    },
    {
      name: "Produkte",
      href: "/dashboard/products",
      icon: <Package className="h-4 w-4" />,
      visible: features.products,
    },
    {
      name: "Angebote",
      href: "/dashboard/ads",
      icon: <Tag className="h-4 w-4" />,
      visible: features.ads,
    },
    {
      name: "Events",
      href: "/dashboard/events",
      icon: <Calendar className="h-4 w-4" />,
      visible: features.events,
    },
    {
      name: "Stories",
      href: "/dashboard/story-collections",
      icon: <BookOpen className="h-4 w-4" />,
      visible: features.storyCollections,
    },
    {
      name: "Vorschlag erstellen",
      href: "/dashboard/proposals/new",
      icon: <Vote className="h-4 w-4" />,
      visible: features.proposals,
    },
    {
      name: "Röbel Card",
      href: "/dashboard/partner",
      icon: <CreditCard className="h-4 w-4" />,
      visible: features.partner,
    },
    {
      name: "Mini-Apps",
      href: "/dashboard/mini-apps",
      icon: <LayoutGrid className="h-4 w-4" />,
      visible: true,
    },
    {
      name: "Einstellungen",
      href: "/dashboard/settings",
      icon: <Settings className="h-4 w-4" />,
      visible: true,
    },
  ];

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === href;
    return pathname === href || pathname?.startsWith(`${href}/`);
  };

  const subTypeLabel = account.sub_type
    ? SUB_TYPE_LABELS[account.sub_type]
    : "Organisation";
  const subTypeIcon = account.sub_type ? SUB_TYPE_EMOJI[account.sub_type] : "🏢";

  return (
    <aside className="md:w-60 md:flex-shrink-0 md:border-r md:border-border md:bg-card md:min-h-[calc(100vh-4rem)]">
      <div className="px-4 py-4 border-b border-border">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Organisation
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-lg" aria-hidden>
            {subTypeIcon}
          </span>
          <p className="text-sm font-medium truncate">{account.name}</p>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{subTypeLabel}</p>
        {account.is_extern && (
          <span
            className={`inline-block mt-2 text-[10px] font-medium px-2 py-0.5 rounded-full ${
              account.extern_status === "approved"
                ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                : account.extern_status === "rejected"
                ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}
          >
            Extern · {account.extern_status ?? "pending"}
          </span>
        )}
        {account.slug &&
          !(account.is_extern && account.extern_status !== "approved") && (
            <Link
              href={`/app/orgs/${account.slug}`}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Öffentliches Profil
            </Link>
          )}
      </div>
      <nav className="p-2 space-y-1">
        {items
          .filter((i) => i.visible)
          .map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive(item.href)
                  ? "bg-muted text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {item.icon}
              <span>{item.name}</span>
            </Link>
          ))}
      </nav>
    </aside>
  );
}
