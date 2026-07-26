"use client";

import Link from "next/link";
import Image from "next/image";
import { CheckCircle } from "lucide-react";
import { useAccount } from "@/lib/context/AccountContext";
import { buildMembershipList } from "@/lib/dashboard/memberships";

export function MembershipsCard({ isCitizen }: { isCitizen: boolean }) {
  const { ownedAccounts } = useAccount();
  const memberships = buildMembershipList({ isCitizen, ownedAccounts });

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-6">
      <h3 className="text-xl font-medium text-foreground mb-4">Mitgliedschaften</h3>

      {memberships.length === 0 ? (
        <p className="text-sm text-muted-foreground">Noch keine Mitgliedschaften.</p>
      ) : (
        <ul className="space-y-2">
          {memberships.map((m) => {
            const row = (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent transition-colors">
                <div className="h-10 w-10 rounded-full bg-muted overflow-hidden flex items-center justify-center flex-shrink-0 text-lg">
                  {m.avatarUrl ? (
                    <Image
                      src={m.avatarUrl}
                      alt={m.name}
                      width={40}
                      height={40}
                      className="object-cover w-full h-full"
                    />
                  ) : (
                    <span>{m.emoji}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{m.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{m.subtitle}</p>
                </div>
                {m.verified && (
                  <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                )}
              </div>
            );
            return <li key={m.id}>{m.href ? <Link href={m.href}>{row}</Link> : row}</li>;
          })}
        </ul>
      )}
    </div>
  );
}
