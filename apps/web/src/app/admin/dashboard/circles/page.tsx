"use client";

// Admin · Circles Verification — a visual on-chain record of where every Röbel
// citizen stands toward being a verified Röbel Münzen member (Circles human on Gnosis).
// Read-only: Hub.isHuman / CitizenNFT.hasCitizenNFT / group-trust via thirdweb, and
// per-token balances (raw vs WRAPPED personal CRC, Röbel Münzen) via the Circles RPC.
import { useCallback, useEffect, useMemo, useState } from "react";
import { getContract, readContract } from "thirdweb";
import { client } from "@/app/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, ShieldCheck, Users, Coins } from "lucide-react";
import {
  gnosis,
  circlesHubAddress,
  productionCitizenNFTGnosisAddress,
  roebeltalerGroupAddress,
  circlesRpcUrl,
  GNOSIS_CITIZENS,
  shortAddr,
} from "@/lib/gnosis";

const hub = getContract({ client, chain: gnosis, address: circlesHubAddress });
const productionCitizenNft = getContract({
  client,
  chain: gnosis,
  address: productionCitizenNFTGnosisAddress,
});
const GROUP = roebeltalerGroupAddress.toLowerCase();

type Row = {
  address: string;
  attester: boolean;
  citizenNFT: boolean | null;
  isHuman: boolean | null;
  invited: boolean | null;
  collateralTrusted: boolean | null;
  personalRaw: number;
  personalWrapped: number;
  roebelTaler: number;
  error?: boolean;
};

async function tokenBalances(addr: string) {
  const res = await fetch(circlesRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "circles_getTokenBalances", params: [addr] }),
  });
  const json = await res.json();
  const list: any[] = json?.result ?? [];
  let personalRaw = 0, personalWrapped = 0, roebelTaler = 0;
  for (const t of list) {
    const owner = String(t.tokenOwner ?? "").toLowerCase();
    const id = String(t.tokenId ?? t.tokenAddress ?? "").toLowerCase();
    const c = Number(t.circles ?? 0);
    if (id === GROUP) roebelTaler += c;
    else if (owner === addr.toLowerCase() && !t.isGroup) {
      if (t.isWrapped) personalWrapped += c;
      else personalRaw += c;
    }
  }
  return { personalRaw, personalWrapped, roebelTaler };
}

// "Invited" = a HUMAN (not the group, not self) trusts this address but it isn't a
// registered human yet — the intermediate state between unverified and verified.
async function invitedByHuman(addr: string): Promise<boolean> {
  try {
    const res = await fetch(circlesRpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "circles_query",
        params: [{
          Namespace: "V_Crc", Table: "TrustRelations", Columns: [],
          Filter: [{ Type: "Conjunction", ConjunctionType: "And", Predicates: [
            { Type: "FilterPredicate", FilterType: "Equals", Column: "version", Value: 2 },
            { Type: "FilterPredicate", FilterType: "Equals", Column: "trustee", Value: addr.toLowerCase() },
          ]}],
          Order: [],
        }],
      }),
    });
    const json = await res.json();
    const cols: string[] = json?.result?.columns ?? [];
    const rows: any[][] = json?.result?.rows ?? [];
    const ti = cols.indexOf("truster");
    const self = addr.toLowerCase();
    return rows.some((r) => {
      const t = String(r[ti] ?? "").toLowerCase();
      return t && t !== self && t !== GROUP;
    });
  } catch {
    return false;
  }
}

async function loadRow(c: { address: string; attester: boolean }): Promise<Row> {
  try {
    const [citizenNFT, isHuman, collateralTrusted, bal, invited] = await Promise.all([
      readContract({ contract: productionCitizenNft, method: "function hasCitizenNFT(address) view returns (bool)", params: [c.address] }),
      readContract({ contract: hub, method: "function isHuman(address) view returns (bool)", params: [c.address] }),
      readContract({ contract: hub, method: "function isTrusted(address,address) view returns (bool)", params: [roebeltalerGroupAddress, c.address] }),
      tokenBalances(c.address),
      invitedByHuman(c.address),
    ]);
    return { ...c, citizenNFT, isHuman, collateralTrusted, ...bal, invited };
  } catch {
    return { ...c, citizenNFT: null, isHuman: null, invited: null, collateralTrusted: null, personalRaw: 0, personalWrapped: 0, roebelTaler: 0, error: true };
  }
}

const fmt = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CirclesVerificationPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await Promise.all(GNOSIS_CITIZENS.map(loadRow));
    setRows(r);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const stats = useMemo(() => {
    const humans = rows.filter((r) => r.isHuman).length;
    const nfts = rows.filter((r) => r.citizenNFT).length;
    const holders = rows.filter((r) => r.roebelTaler > 0).length;
    return { humans, nfts, holders, total: GNOSIS_CITIZENS.length };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-medium text-foreground">Circles-Verifizierung</h1>
          <p className="text-sm text-muted-foreground">
            On-chain Status jedes Bürgers Richtung Röbel Münzen-Mitgliedschaft (Gnosis · Circles v2).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Aktualisieren
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />} label="Verifizierte Circles-Menschen" value={`${stats.humans} / ${stats.total}`} />
        <StatCard icon={<Users className="h-4 w-4 text-muted-foreground" />} label="CitizenNFT (Gnosis)" value={`${stats.nfts} / ${stats.total}`} />
        <StatCard icon={<Coins className="h-4 w-4 text-muted-foreground" />} label="Halten Röbel Münzen" value={`${stats.holders} / ${stats.total}`} />
      </div>

      <Card className="bg-card border border-border shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Bürger ({stats.total})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2 pr-4 font-medium">Wallet</th>
                <th className="py-2 pr-4 font-medium">CitizenNFT</th>
                <th className="py-2 pr-4 font-medium">Verifiziert</th>
                <th className="py-2 pr-4 font-medium">Röbel Münzen</th>
                <th className="py-2 pr-4 font-medium">Persönl. CRC (roh / wrapped)</th>
                <th className="py-2 pr-4 font-medium">Sicherheit</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="py-3 pr-4" colSpan={6}><Skeleton className="h-5 w-full" /></td>
                    </tr>
                  ))
                : rows.map((r) => (
                    <tr key={r.address} className="border-b border-border">
                      <td className="py-3 pr-4">
                        <a
                          href={`https://explorer.aboutcircles.com/avatar/${r.address}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-xs text-foreground hover:underline"
                          title="Auf dem Circles Explorer ansehen"
                        >
                          {shortAddr(r.address)} <span className="text-muted-foreground">↗</span>
                        </a>
                        {r.attester && <Badge variant="outline" className="ml-2 text-[10px]">Attester</Badge>}
                      </td>
                      <td className="py-3 pr-4"><Bool v={r.citizenNFT} /></td>
                      <td className="py-3 pr-4">
                        {r.isHuman == null ? (
                          <Dim>?</Dim>
                        ) : r.isHuman ? (
                          <Badge className="bg-green-600/15 text-green-700 hover:bg-green-600/15 border-0">✓ Verifiziert</Badge>
                        ) : r.invited ? (
                          <Badge className="bg-blue-600/15 text-blue-700 hover:bg-blue-600/15 border-0">Eingeladen</Badge>
                        ) : (
                          <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 border-0">Nicht verifiziert</Badge>
                        )}
                      </td>
                      <td className="py-3 pr-4 tabular-nums text-foreground">{fmt(r.roebelTaler)}</td>
                      <td className="py-3 pr-4 tabular-nums">
                        <span className="text-foreground">{fmt(r.personalRaw)}</span>
                        <span className="text-muted-foreground"> / {fmt(r.personalWrapped)}</span>
                      </td>
                      <td className="py-3 pr-4">{r.collateralTrusted
                        ? <Badge variant="outline" className="text-[10px]">Gruppe vertraut</Badge>
                        : <Dim>—</Dim>}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
          <div className="mt-4 space-y-2">
            <p className="text-xs text-muted-foreground">
              „Persönl. CRC (roh / wrapped)“: Einladen verbrennt <strong>rohes</strong> ERC-1155-Guthaben — gewrapptes
              (ERC-20) muss erst entpackt werden. Jede Wallet verlinkt zu ihrem Profil auf dem Circles Explorer.
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="text-muted-foreground">Onchain-Belege:</span>
              <a className="text-primary hover:underline" target="_blank" rel="noreferrer" href={`https://explorer.aboutcircles.com/avatar/${roebeltalerGroupAddress}`}>Röbel Münzen Gruppe ↗</a>
              <a className="text-primary hover:underline" target="_blank" rel="noreferrer" href={`https://gnosisscan.io/address/${productionCitizenNFTGnosisAddress}`}>CitizenNFT ↗</a>
              <a className="text-primary hover:underline" target="_blank" rel="noreferrer" href={`https://gnosisscan.io/address/${circlesHubAddress}`}>Circles Hub ↗</a>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="bg-card border border-border shadow-none">
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</div>
        <div className="mt-2 text-2xl font-medium text-foreground tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function Bool({ v }: { v: boolean | null }) {
  if (v == null) return <Dim>?</Dim>;
  return v ? <span className="text-green-700">✓</span> : <span className="text-muted-foreground">✗</span>;
}
function Dim({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}
