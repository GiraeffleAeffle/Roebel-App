"use client";

import { useEffect, useState } from "react";
import { readSyntheticBriefResponse, syntheticBriefPath, type SyntheticCitizenBriefBinding,
  type SyntheticCitizenBriefReturn } from "@roebel/stadtstack-federation-client";

/** One verified read supplies both the progress display and the response body. */
export function useSyntheticCitizenBrief(binding: SyntheticCitizenBriefBinding | null) {
  const [received, setReceived] = useState<SyntheticCitizenBriefReturn | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const caseId = binding?.caseId, discussionId = binding?.discussionId, topicId = binding?.topicId;
  useEffect(() => {
    const controller = new AbortController();
    setReceived(null); setError(false);
    if (caseId && discussionId && topicId) {
      void fetch(syntheticBriefPath(discussionId), { credentials: "omit", cache: "no-store", redirect: "error",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
        .then(response => readSyntheticBriefResponse(response, { caseId, discussionId, topicId }))
        .then(value => { if (!controller.signal.aborted) setReceived(value); })
        .catch(() => { if (!controller.signal.aborted) setError(true); });
    }
    return () => controller.abort();
  }, [caseId, discussionId, topicId, revision]);
  // A route change must not display the previous Case for even one render.
  const value = received?.caseId === caseId && received?.discussionId === discussionId && received?.topicId === topicId ? received : null;
  return { value, error, refresh: () => { setReceived(null); setError(false); setRevision(r => r + 1); } };
}
