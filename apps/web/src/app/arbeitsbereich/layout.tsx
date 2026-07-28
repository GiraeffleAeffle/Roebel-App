"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { AuthGuard } from "@/components/app/AuthGuard";
import { AccountProvider } from "@/lib/context/AccountContext";
import { AppModeProvider } from "@/lib/context/AppModeContext";
import { WorkspaceSidebar } from "@/components/workspace/WorkspaceSidebar";
import { WorkspaceSessionGuard } from "@/components/workspace/WorkspaceSessionGuard";

export default function ArbeitsbereichLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <AppModeProvider>
        <AccountProvider>
          <WorkspaceSessionGuard />
          <div className="min-h-screen bg-background flex flex-col">
            <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 md:px-6 sticky top-0 z-30">
              <Link href="/app" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <Image
                  src="/Logo-new.png"
                  alt="Röbel App"
                  width={105}
                  height={24}
                  className="h-6 w-auto object-contain"
                />
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  · Arbeitsbereich
                </span>
              </Link>
              <Link
                href="/app"
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Zur App
              </Link>
            </header>
            <div className="flex-1 md:flex md:items-stretch">
              <WorkspaceSidebar />
              <main className="flex-1 px-4 py-6 md:px-8 md:py-8 max-w-6xl w-full">
                {children}
              </main>
            </div>
          </div>
        </AccountProvider>
      </AppModeProvider>
    </AuthGuard>
  );
}
