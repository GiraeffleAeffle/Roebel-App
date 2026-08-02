"use client";

import { useState, useEffect } from "react";
import { ConnectButton, useActiveAccount } from "thirdweb/react";
import { client } from "@/app/client";
import { activeChain } from "@/lib/chains";
import { wallets } from "@/lib/wallet-config";
import { ProfileDropdown } from "@/components/app/ProfileDropdown";
import Link from "next/link";
import Image from "next/image";
import { Bell, MessageSquare, Search, Menu } from "lucide-react";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";
import { useUnreadMessages } from "@/hooks/useUnreadMessages";
import { NotificationDot } from "@/components/ui/notification-dot";
import { useTheme } from "next-themes";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { hasSupabase } from "@/lib/record";

interface AppHeaderProps {
  onToggleMobileSidebar?: () => void;
}

export function AppHeader({ onToggleMobileSidebar }: AppHeaderProps) {
  const { unreadCount } = useUnreadNotifications();
  const { unreadCount: unreadMessages } = useUnreadMessages();
  const account = useActiveAccount();
  const { resolvedTheme } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);

  // Global CMD+K / Ctrl+K shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-50 h-16 bg-card flex items-center px-4 gap-4">
        {/* Mobile menu button */}
        <button
          onClick={onToggleMobileSidebar}
          className="md:hidden p-2 text-muted-foreground hover:text-foreground rounded-md transition-colors"
          aria-label="Menü öffnen"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Mobile logo (visible only on mobile where sidebar is hidden) */}
        <Link href="/app" className="flex items-center flex-shrink-0 md:hidden">
          <Image
            src="/Logo-new.png"
            alt="Röbel App"
            width={122}
            height={28}
            className="h-7 w-auto object-contain"
          />
        </Link>

        {/* Search trigger — desktop */}
        <div className="flex-1 max-w-lg mx-auto hidden sm:block">
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full flex items-center gap-2 pl-3 pr-3 py-2 bg-muted border border-transparent rounded-full text-sm text-muted-foreground hover:border-border hover:bg-card transition-colors cursor-pointer"
          >
            <Search className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1 text-left">Suche...</span>
            <kbd className="hidden md:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/60 bg-background rounded border border-border">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right section */}
        <div className="flex items-center gap-1 sm:gap-2 ml-auto">
          {/* Mobile search button */}
          <button
            onClick={() => setSearchOpen(true)}
            className="sm:hidden p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-accent transition-colors"
            aria-label="Suche"
          >
            <Search className="h-5 w-5" />
          </button>

          {/* Notifications */}
          <Link
            href="/app/notifications"
            className="relative p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-accent transition-colors"
            aria-label="Benachrichtigungen"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5">
                <NotificationDot count={unreadCount} showNumber size="md" />
              </span>
            )}
          </Link>

          {/* Messages */}
          <Link
            href="/app/messages"
            className="relative p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-accent transition-colors"
            aria-label="Nachrichten"
          >
            <MessageSquare className="h-5 w-5" />
            {unreadMessages > 0 && (
              <span className="absolute -top-0.5 -right-0.5">
                <NotificationDot count={unreadMessages} showNumber size="md" />
              </span>
            )}
          </Link>

          {/* Connect Button / Profile — no login in read-only record mode */}
          {account ? (
            <ProfileDropdown />
          ) : !hasSupabase ? null : (
            <ConnectButton
              client={client}
              chain={activeChain}
              wallets={wallets}
              autoConnect={false}
              connectButton={{
                label: "Anmelden",
                style: {
                  backgroundColor:
                    resolvedTheme === "dark" ? "#7ABBF2" : "#00498B",
                  color: resolvedTheme === "dark" ? "#202124" : "#ffffff",
                  borderRadius: "9999px",
                  fontWeight: 600,
                  minWidth: "auto",
                  height: "40px",
                },
              }}
              connectModal={{
                title: "Bei Röbel/Müritz DAO anmelden",
                size: "compact",
              }}
              theme={resolvedTheme === "dark" ? "dark" : "light"}
            />
          )}
        </div>
      </header>

      {/* Global search dialog */}
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
