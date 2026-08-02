"use client"

import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Plus, Menu, X } from "lucide-react"
import { useState } from "react"
import { ConnectButton, useActiveAccount } from "thirdweb/react"
import { client } from "@/app/client"
import { activeChain } from "@/lib/chains"
import { wallets } from "@/lib/wallet-config"
import { ProfilePill } from "@/components/layout/ProfilePill"
import { hasSupabase } from "@/lib/record"

const NAV_LINKS = [
  { href: "/", label: "Events" },
  { href: "/app", label: "App" },
  { href: "/unternehmen", label: "Unternehmen" },
  { href: "/submit", label: "Event einreichen" },
]

export function EventsHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const account = useActiveAccount()

  return (
    <header className="bg-card border-b border-border">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <Link href="/" className="flex items-center hover:opacity-80 transition-opacity flex-shrink-0">
            <Image
              src="/Logo-new.png"
              alt="Röbel App"
              width={140}
              height={32}
              className="h-7 w-auto object-contain md:h-8"
            />
          </Link>

          <nav className="hidden md:flex items-center gap-6 lg:gap-8">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm lg:text-base text-foreground hover:text-foreground/80 transition-colors font-medium whitespace-nowrap"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2 md:gap-3">
            {account ? (
              <ProfilePill />
            ) : !hasSupabase ? null : (
              <ConnectButton
                client={client}
                chain={activeChain}
                wallets={wallets}
                autoConnect={false}
                connectModal={{
                  title: "Bei Röbel/Müritz DAO anmelden",
                  size: "compact",
                }}
                theme="light"
              />
            )}

            <Button asChild className="h-9 md:h-10 px-3 md:px-5 text-sm md:text-base">
              <Link href="/submit">
                <Plus className="h-4 w-4 md:mr-2" />
                <span className="hidden sm:inline">Hinzufügen</span>
              </Link>
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Menü umschalten"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <nav className="md:hidden pt-4 pb-2 border-t border-border mt-3">
            <div className="flex flex-col gap-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-foreground hover:bg-accent transition-colors font-medium px-2 py-2.5 rounded-md"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.label}
                </Link>
              ))}
              {account && (
                <Link
                  href="/profile"
                  className="text-foreground hover:bg-accent transition-colors font-medium px-2 py-2.5 rounded-md"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Profil
                </Link>
              )}
            </div>
          </nav>
        )}
      </div>
    </header>
  )
}
