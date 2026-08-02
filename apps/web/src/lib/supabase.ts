import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type {
  Proposal,
  CreateProposalInput,
  UpdateProposalVotesInput,
  ProposalFilters,
  ProposalsPaginatedResponse,
  ProposalContent,
} from "./proposal-types";
import { RecordClient, listProposals, RecordUnavailableError, type ProposalMetaRow } from "@netizen-labs/record-client";

// Supabase client configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** True when this deployment has a Supabase backend. A keyless fork runs in
 * record mode: public reads come from the node index, everything else is
 * hidden or fails loudly at the point of use — never silently. */
export const hasSupabase = Boolean(supabaseUrl && supabaseAnonKey);

/** In record mode any ACCESS of the client throws with a clear message, so an
 * unported private-data path surfaces as a visible error, not an empty page. */
function keylessProxy(): SupabaseClient {
  return new Proxy({} as SupabaseClient, {
    get(_t, prop) {
      throw new Error(
        `Supabase ist nicht konfiguriert (record mode) — '${String(prop)}' ist ohne Backend nicht verfügbar.`,
      );
    },
  });
}

/**
 * Supabase client singleton
 * Used for client-side and server-side operations
 */
export const supabase: SupabaseClient = hasSupabase
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : keylessProxy();

/** Record-mode read client for getProposals/getProposalStats below. Built
 * locally (rather than importing `@/lib/record`'s singleton) because that
 * module itself re-exports `hasSupabase` FROM this file — importing back
 * from it here would be circular. Same default index URL either way. */
const proposalsRecordClient = new RecordClient(
  process.env.NEXT_PUBLIC_NODE_INDEX_URL ?? "https://index.roebel.app",
);

/**
 * Database schema types
 */
export interface Database {
  public: {
    Tables: {
      proposals: {
        Row: Proposal;
        Insert: Omit<
          Proposal,
          "id" | "created_at" | "updated_at" | "last_synced_at"
        >;
        Update: Partial<
          Omit<Proposal, "id" | "proposal_id" | "created_at">
        >;
      };
    };
  };
}

/**
 * Create a new proposal in Supabase
 */
export async function createProposal(
  input: CreateProposalInput
): Promise<{ success: boolean; data?: Proposal; error?: string }> {
  console.log("📝 [Supabase] Creating proposal:", input.proposal_id);

  try {
    const { data, error } = await supabase
      .from("proposals")
      .insert({
        proposal_id: input.proposal_id,
        blockchain_proposal_id: input.blockchain_proposal_id,
        proposal_number: input.proposal_number,
        title: input.title,
        summary: input.summary,
        content: input.content,
        category: input.category || "general",
        irys_content_id: input.irys_content_id,
        irys_url: input.irys_url,
        transaction_hash: input.transaction_hash,
        proposer_address: input.proposer_address.toLowerCase(),
        block_number: input.block_number.toString(),
        snapshot_block: input.snapshot_block.toString(),
        deadline_block: input.deadline_block.toString(),
        state: 0, // Pending initially
        for_votes: "0",
        against_votes: "0",
        abstain_votes: "0",
      })
      .select()
      .single();

    if (error) {
      console.error("❌ [Supabase] Error creating proposal:", error);
      return { success: false, error: error.message };
    }

    console.log("✅ [Supabase] Proposal created successfully");
    return { success: true, data: data as Proposal };
  } catch (error) {
    console.error("❌ [Supabase] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get a single proposal by proposal_id
 */
export async function getProposal(
  proposalId: string
): Promise<{ success: boolean; data?: Proposal; error?: string }> {
  console.log("🔍 [Supabase] Fetching proposal:", proposalId);

  try {
    const { data, error } = await supabase
      .from("proposals")
      .select("*")
      .eq("proposal_id", proposalId)
      .single();

    if (error) {
      console.error("❌ [Supabase] Error fetching proposal:", error);
      return { success: false, error: error.message };
    }

    console.log("✅ [Supabase] Proposal fetched successfully");
    return { success: true, data: data as Proposal };
  } catch (error) {
    console.error("❌ [Supabase] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * ProposalMetaRow (civic.ts) carries no vote tallies, proposer wallet, block
 * numbers or full markdown content — those live on-chain / on Irys, which
 * detail pages already read directly (per the brief: "detail pages read
 * chain and Irys as they already do, so do not fabricate tallies"). List
 * views get explicit, honest neutrals — never a fake vote count. Every
 * consumer that renders votes already gates on `totalVotes > 0n`
 * (ProposalCard), so an all-"0" row degrades to simply hiding that row,
 * not a broken control.
 */
function toProposal(r: ProposalMetaRow): Proposal {
  return {
    id: r.proposal_id,
    proposal_id: r.proposal_id,
    // onchain_id resolves the "proposal_id" TAG (the chain's numeric id) —
    // NOT r.proposal_id itself, which is the record's own d-tag identity /
    // tx-hash-routing id (see civic.ts's ProposalMetaRow doc comment on the
    // naming collision). "" only when the tag was never published.
    blockchain_proposal_id: r.onchain_id ?? "",
    proposal_number: 0,
    title: r.title,
    summary: r.summary,
    content: { markdown: "", version: "1" },
    category: (r.category ?? "general") as Proposal["category"],
    irys_content_id: r.irys_tx ?? "",
    irys_url: r.irys_tx ? `https://gateway.irys.xyz/${r.irys_tx}` : "",
    transaction_hash: r.proposal_id,
    // Never published (privacy) — never a fabricated/raw wallet address.
    proposer_address: "",
    block_number: null,
    snapshot_block: null,
    deadline_block: null,
    state: Number(r.status ?? 0),
    for_votes: "0",
    against_votes: "0",
    abstain_votes: "0",
    created_at: r.published_at ?? "",
    updated_at: r.published_at ?? "",
    last_synced_at: null,
  };
}

async function getProposalsFromRecord(
  filters?: ProposalFilters
): Promise<{ success: boolean; data?: ProposalsPaginatedResponse; error?: string }> {
  try {
    const rows = await listProposals(proposalsRecordClient, { limit: 200 });
    let proposals = rows.map(toProposal);

    if (filters?.state !== undefined) {
      const states = Array.isArray(filters.state) ? filters.state : [filters.state];
      proposals = proposals.filter((p) => states.includes(p.state));
    }
    if (filters?.category !== undefined) {
      const categories = Array.isArray(filters.category) ? filters.category : [filters.category];
      proposals = proposals.filter((p) => categories.includes(p.category));
    }
    if (filters?.proposer) {
      // proposer_address is never published — this correctly yields no
      // matches rather than pretending to resolve one.
      proposals = proposals.filter((p) => p.proposer_address === filters.proposer!.toLowerCase());
    }
    if (filters?.search) {
      const needle = filters.search.toLowerCase();
      proposals = proposals.filter(
        (p) => p.title.toLowerCase().includes(needle) || p.summary.toLowerCase().includes(needle)
      );
    }

    // proposal_number/total_votes carry no real signal in record mode (both
    // are always 0/"0") — created_at is the only field with genuine
    // ordering information, so every orderBy falls back to it.
    const dir = (filters?.orderDirection || "desc") === "asc" ? 1 : -1;
    proposals.sort((a, b) => dir * a.created_at.localeCompare(b.created_at));

    const limit = filters?.limit || 10;
    const offset = filters?.offset || 0;
    const page = proposals.slice(offset, offset + limit);

    return {
      success: true,
      data: {
        proposals: page,
        total: proposals.length,
        limit,
        offset,
        has_more: proposals.length > offset + limit,
      },
    };
  } catch (error) {
    if (error instanceof RecordUnavailableError) {
      return { success: true, data: { proposals: [], total: 0, limit: filters?.limit || 10, offset: filters?.offset || 0, has_more: false } };
    }
    throw error;
  }
}

/**
 * Get all proposals with optional filtering, sorting, and pagination
 */
export async function getProposals(
  filters?: ProposalFilters
): Promise<{
  success: boolean;
  data?: ProposalsPaginatedResponse;
  error?: string;
}> {
  if (!hasSupabase) return getProposalsFromRecord(filters);

  console.log("📋 [Supabase] Fetching proposals with filters:", filters);

  try {
    let query = supabase.from("proposals").select("*", { count: "exact" });

    // Apply filters
    if (filters?.state !== undefined) {
      if (Array.isArray(filters.state)) {
        query = query.in("state", filters.state);
      } else {
        query = query.eq("state", filters.state);
      }
    }

    if (filters?.category !== undefined) {
      if (Array.isArray(filters.category)) {
        query = query.in("category", filters.category);
      } else {
        query = query.eq("category", filters.category);
      }
    }

    if (filters?.proposer) {
      query = query.eq("proposer_address", filters.proposer.toLowerCase());
    }

    if (filters?.search) {
      // Full-text search on title and summary
      query = query.or(
        `title.ilike.%${filters.search}%,summary.ilike.%${filters.search}%`
      );
    }

    // Apply sorting
    const orderBy = filters?.orderBy || "created_at";
    const orderDirection = filters?.orderDirection || "desc";
    query = query.order(orderBy, { ascending: orderDirection === "asc" });

    // Apply pagination
    const limit = filters?.limit || 10;
    const offset = filters?.offset || 0;
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error("❌ [Supabase] Error fetching proposals:", error);
      return { success: false, error: error.message };
    }

    console.log(`✅ [Supabase] Fetched ${data?.length || 0} proposals`);

    return {
      success: true,
      data: {
        proposals: (data as Proposal[]) || [],
        total: count || 0,
        limit,
        offset,
        has_more: (count || 0) > offset + limit,
      },
    };
  } catch (error) {
    console.error("❌ [Supabase] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Update proposal voting state and vote counts
 */
export async function updateProposalVotes(
  input: UpdateProposalVotesInput
): Promise<{ success: boolean; data?: Proposal; error?: string }> {
  console.log("🔄 [Supabase] Updating proposal votes:", input.proposal_id);

  try {
    const { data, error } = await supabase
      .from("proposals")
      .update({
        state: input.state,
        for_votes: input.for_votes,
        against_votes: input.against_votes,
        abstain_votes: input.abstain_votes,
        last_synced_at: new Date().toISOString(),
      })
      .eq("proposal_id", input.proposal_id)
      .select()
      .single();

    if (error) {
      console.error("❌ [Supabase] Error updating proposal:", error);
      return { success: false, error: error.message };
    }

    console.log("✅ [Supabase] Proposal updated successfully");
    return { success: true, data: data as Proposal };
  } catch (error) {
    console.error("❌ [Supabase] Unexpected error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get proposal statistics
 */
export async function getProposalStats(): Promise<{
  success: boolean;
  data?: {
    total: number;
    active: number;
    succeeded: number;
    defeated: number;
    executed: number;
  };
  error?: string;
}> {
  if (!hasSupabase) {
    try {
      const rows = await listProposals(proposalsRecordClient, { limit: 200 });
      const states = rows.map((r) => Number(r.status ?? 0));
      const count = (state: number) => states.filter((s) => s === state).length;
      return {
        success: true,
        data: {
          total: states.length,
          active: count(1), // ProposalState.Active
          succeeded: count(4), // ProposalState.Succeeded
          defeated: count(3), // ProposalState.Defeated
          executed: count(7), // ProposalState.Executed
        },
      };
    } catch (error) {
      if (error instanceof RecordUnavailableError) {
        return { success: true, data: { total: 0, active: 0, succeeded: 0, defeated: 0, executed: 0 } };
      }
      throw error;
    }
  }

  console.log("📊 [Supabase] Fetching proposal statistics");

  try {
    const [totalRes, activeRes, succeededRes, defeatedRes, executedRes] =
      await Promise.all([
        supabase.from("proposals").select("*", { count: "exact", head: true }),
        supabase
          .from("proposals")
          .select("*", { count: "exact", head: true })
          .eq("state", 1), // Active
        supabase
          .from("proposals")
          .select("*", { count: "exact", head: true })
          .eq("state", 4), // Succeeded
        supabase
          .from("proposals")
          .select("*", { count: "exact", head: true })
          .eq("state", 3), // Defeated
        supabase
          .from("proposals")
          .select("*", { count: "exact", head: true })
          .eq("state", 7), // Executed
      ]);

    return {
      success: true,
      data: {
        total: totalRes.count || 0,
        active: activeRes.count || 0,
        succeeded: succeededRes.count || 0,
        defeated: defeatedRes.count || 0,
        executed: executedRes.count || 0,
      },
    };
  } catch (error) {
    console.error("❌ [Supabase] Error fetching stats:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check if a proposal exists by proposal_id
 */
export async function proposalExists(proposalId: string): Promise<boolean> {
  const { count } = await supabase
    .from("proposals")
    .select("*", { count: "exact", head: true })
    .eq("proposal_id", proposalId);

  return (count || 0) > 0;
}

/**
 * Get the latest proposal number (for auto-incrementing)
 */
export async function getLatestProposalNumber(): Promise<number> {
  const { data } = await supabase
    .from("proposals")
    .select("proposal_number")
    .order("proposal_number", { ascending: false })
    .limit(1)
    .single();

  return data?.proposal_number || 0;
}
