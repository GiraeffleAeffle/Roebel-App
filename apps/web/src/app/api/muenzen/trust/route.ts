// GET /api/muenzen/trust — the Röbel web-of-trust graph + composite civic
// reputation for the Vertrauen & Reputation tab. Nodes = avatars (group hub,
// citizens, holders, inviters), edges = Circles trust relations. Reputation
// blends trust degree + attendance + civic activity + economic footprint.
import { NextResponse } from "next/server";
import { getAddress } from "viem";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, isFresh, jsonError } from "@/lib/muenzen/api";
import { cached, TTL } from "@/lib/muenzen/cache";
import { gnosisClient } from "@/lib/muenzen/gnosis";
import { loadHolders, loadCitizens, loadTransfers } from "@/lib/muenzen/economy";
import { trustersOf } from "@/lib/muenzen/circles-rpc";
import { resolveIdentities } from "@/lib/muenzen/identity";
import { scoreReputations, type RepInput } from "@/lib/muenzen/reputation";
import { ADDR, ERC721_ABI, ZERO_ADDRESS, attoToNumber } from "@/lib/muenzen/constants";

export const dynamic = "force-dynamic";

const ATTENDANCE_ACTIONS = new Set(["event_attend"]);
const CIVIC_ACTIONS = new Set(["proposal_vote", "checkpoint", "event_submit", "referral"]);

async function attesterSet(addresses: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (!addresses.length) return set;
  try {
    const res = await gnosisClient.multicall({
      allowFailure: true,
      contracts: addresses.map((a) => ({
        address: getAddress(ADDR.productionAttesterNFT),
        abi: ERC721_ABI,
        functionName: "balanceOf" as const,
        args: [getAddress(a)] as const,
      })),
    });
    addresses.forEach((a, i) => {
      const r = res[i];
      if (r?.status === "success" && (r.result as bigint) > 0n) set.add(a);
    });
  } catch {
    /* attester ring is cosmetic — ignore failures */
  }
  return set;
}

export async function GET(req: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const fresh = isFresh(req);

  try {
    const data = await cached(
      "trust",
      TTL.chain,
      async () => {
        const now = Date.now();
        const group = ADDR.group.toLowerCase();
        const operator = process.env.MUENZEN_OPERATOR_ADDRESS?.trim().toLowerCase() || null;

        const [{ holders }, citizenStats, transfers] = await Promise.all([
          loadHolders(fresh),
          loadCitizens(fresh),
          loadTransfers(fresh),
        ]);
        const citizens = new Set(citizenStats.trusted);

        // Edges: group→citizen (the gate) + inviter→citizen (onboarding chain).
        const edges: { source: string; target: string }[] = [];
        const edgeKey = new Set<string>();
        const addEdge = (source: string, target: string) => {
          if (!source || !target || source === target) return;
          const k = `${source}->${target}`;
          if (edgeKey.has(k)) return;
          edgeKey.add(k);
          edges.push({ source, target });
        };

        const inviters = new Set<string>();
        for (const c of citizens) addEdge(group, c);
        await Promise.all(
          [...citizens].slice(0, 30).map(async (c) => {
            const trusters = await trustersOf(c, 25);
            for (const inv of trusters) {
              if (inv === group || inv === c || inv === ZERO_ADDRESS) continue;
              inviters.add(inv);
              addEdge(inv, c);
            }
          }),
        );

        // Node set: group + citizens + top holders + inviters (capped).
        const holderAddrs = holders.slice(0, 40).map((h) => h.address);
        const nodeAddrs = [
          ...new Set([group, ...citizens, ...holderAddrs, ...inviters]),
        ].slice(0, 70);
        const nodeSet = new Set(nodeAddrs);
        // Drop edges that reference a node we trimmed away.
        const keptEdges = edges.filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target));

        // In/out degree within the kept edge set.
        const inDeg = new Map<string, number>();
        const outDeg = new Map<string, number>();
        for (const e of keptEdges) {
          inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
          outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
        }

        // Economic throughput (whole RCRC moved in/out) per address.
        const economic = new Map<string, number>();
        for (const t of transfers) {
          const v = attoToNumber(t.value);
          if (nodeSet.has(t.from)) economic.set(t.from, (economic.get(t.from) ?? 0) + v);
          if (nodeSet.has(t.to)) economic.set(t.to, (economic.get(t.to) ?? 0) + v);
        }

        // Attendance + civic from paid reward claims (empty today; wired).
        const attendance = new Map<string, number>();
        const civic = new Map<string, number>();
        try {
          const supabase = createAdminClient();
          const { data: claims } = await supabase
            .from("reward_claims")
            .select("wallet, action")
            .eq("status", "paid");
          for (const c of claims ?? []) {
            const w = String(c.wallet ?? "").toLowerCase();
            if (!nodeSet.has(w)) continue;
            if (ATTENDANCE_ACTIONS.has(c.action)) attendance.set(w, (attendance.get(w) ?? 0) + 1);
            else if (CIVIC_ACTIONS.has(c.action)) civic.set(w, (civic.get(w) ?? 0) + 1);
          }
        } catch {
          /* claims unavailable — reputation falls back to trust + economic */
        }

        const attesters = await attesterSet(nodeAddrs.filter((a) => a !== group));
        const rcrcByAddr = new Map(holders.map((h) => [h.address, h.rcrc]));
        const identities = await resolveIdentities(nodeAddrs);

        // Reputation excludes the group hub itself.
        const repInputs: RepInput[] = nodeAddrs
          .filter((a) => a !== group)
          .map((a) => ({
            address: a,
            trustInDegree: inDeg.get(a) ?? 0,
            attendance: attendance.get(a) ?? 0,
            civic: civic.get(a) ?? 0,
            economic: economic.get(a) ?? 0,
          }));
        const scored = scoreReputations(repInputs);
        const scoreByAddr = new Map(scored.map((s) => [s.address, s]));

        const kindOf = (a: string): string => {
          if (a === group) return "group";
          if (operator && a === operator) return "operator";
          if (citizens.has(a)) return "citizen";
          return "holder";
        };

        const nodes = nodeAddrs.map((a) => {
          const id = identities.get(a);
          return {
            id: a,
            name: id?.name ?? null,
            kind: kindOf(a),
            isAttester: attesters.has(a),
            rcrc: rcrcByAddr.get(a) ?? 0,
            score: scoreByAddr.get(a)?.score ?? 0,
            trustIn: inDeg.get(a) ?? 0,
            trustOut: outDeg.get(a) ?? 0,
          };
        });

        const leaderboard = scored.slice(0, 20).map((s) => ({
          address: s.address,
          name: identities.get(s.address)?.name ?? null,
          avatarUrl: identities.get(s.address)?.avatarUrl ?? null,
          score: s.score,
          parts: s.parts,
          trustIn: s.trustInDegree,
          attendance: s.attendance,
          civic: s.civic,
          economic: s.economic,
          rcrc: rcrcByAddr.get(s.address) ?? 0,
        }));

        // Score distribution histogram (5 buckets of 20).
        const distribution = [0, 1, 2, 3, 4].map((b) => ({
          bucket: `${b * 20}–${b * 20 + 20}`,
          count: scored.filter((s) => s.score >= b * 20 && (b === 4 ? s.score <= 100 : s.score < b * 20 + 20)).length,
        }));

        return {
          nodes,
          edges: keptEdges,
          leaderboard,
          distribution,
          stats: {
            nodes: nodes.length,
            edges: keptEdges.length,
            citizensTrusted: citizenStats.trusted.length,
            citizensJoined: citizenStats.joined,
            attesters: attesters.size,
          },
          generatedAt: now,
        };
      },
      fresh,
    );

    return NextResponse.json(data);
  } catch (e) {
    return jsonError(e);
  }
}
