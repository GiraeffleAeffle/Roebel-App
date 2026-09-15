import { readSyntheticBriefResponse, syntheticBriefPath, type SyntheticCitizenBriefBinding } from "@roebel/stadtstack-federation-client";
import { loadPublicCivicDiscussion } from "./civic-projection-client";
import type { PublicCivicPostLink } from "./civic-topic-detail";
import { loadVerifiedPublicCaseBindingReceipt } from "./public-case-binding-receipt-client";
import { bindSyntheticCitizenBrief, projectSyntheticJourney } from "./synthetic-journey";

const readers = {
  loadReceipt: loadVerifiedPublicCaseBindingReceipt,
  loadDiscussion: loadPublicCivicDiscussion,
  async loadBrief(binding: SyntheticCitizenBriefBinding) {
    return readSyntheticBriefResponse(await fetch(syntheticBriefPath(binding.discussionId), {
      method: "GET", credentials: "omit", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(10_000),
    }), binding);
  },
};

/** Keep the feed on the same verified test-return lane as its discussion. */
export async function loadCurrentPostJourney(link: PublicCivicPostLink, dependencies = readers) {
  const receipt = await dependencies.loadReceipt(link.discussionId);
  if (receipt?.schemaVersion !== "public_synthetic_case_binding_receipt_v1") return link.journey;
  const thread = await dependencies.loadDiscussion(link.discussionId);
  const binding = bindSyntheticCitizenBrief(receipt, thread, link.discussionId);
  if (!binding || binding.topicId !== link.detail.topic.topicId) {
    throw new Error("public_case_binding_mismatch");
  }
  const returned = await dependencies.loadBrief(binding);
  return projectSyntheticJourney(link.journey, binding, returned);
}
