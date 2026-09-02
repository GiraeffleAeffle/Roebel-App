"use client";

import { Info } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatAddress } from "@/lib/proposal-types";
import { de } from "@/lib/translations/de";
import { CONTRACTS } from "@roebel/blockchain";

// Gnosis v2 Sybil-hardened stack (chainId 100, 2026-06-25). Source of truth:
// contracts/governor-contract/deployments/gnosis-v2.json.
function gnosisscanAddress(address: string): string {
  return `https://gnosisscan.io/address/${address}`;
}

const CONTRACT_ROWS = [
  {
    role: de.governance.roleGovernor,
    address: "0x5F5e499Dc1872c2Ce19a4b50cd10f680e78E3Ba3",
  },
  {
    role: de.governance.roleTimelock,
    address: "0x5b358A77E89FF3d699607b4fC235b381d67f3d05",
  },
  {
    role: de.governance.roleCitizenNFT,
    address: CONTRACTS.citizenNFT,
  },
  {
    role: de.governance.roleAttesterNFT,
    address: CONTRACTS.attesterNFT,
  },
] as const;

export function ContractsInfoDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={de.governance.contractsTitle}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:border-primary hover:text-primary"
        >
          <Info className="h-5 w-5" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{de.governance.contractsTitle}</DialogTitle>
          <DialogDescription>
            {de.governance.contractsLead}
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y divide-border">
          {CONTRACT_ROWS.map(({ role, address }) => (
            <li
              key={address}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{role}</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {formatAddress(address, 10, 8)}
                </p>
              </div>
              <a
                href={gnosisscanAddress(address)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-primary hover:underline"
              >
                {de.governance.openOnBasescan} ↗
              </a>
            </li>
          ))}
        </ul>

        <p className="text-xs text-muted-foreground">
          {de.governance.timelineFooter}
        </p>
      </DialogContent>
    </Dialog>
  );
}
