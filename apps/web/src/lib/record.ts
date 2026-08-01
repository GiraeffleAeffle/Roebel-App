import { RecordClient } from "@netizen-labs/record-client";
export { hasSupabase } from "@/lib/supabase";

/** The node's public index — the read path of record mode. Default is Röbel's
 * own node, so a bare fork shows exactly the town's public record. */
export const recordClient = new RecordClient(
  process.env.NEXT_PUBLIC_NODE_INDEX_URL ?? "https://index.roebel.app",
);
