import type { StagingArgument } from "./discussion-tree";

export const STADTSTACK_STAGING_API = "/stadtstack-test/api" as const;

export type StagingFeedPost = {
  id: string;
  author: { name: string; kind: "citizen" | "mecky"; pubkey: string };
  content: string;
  createdAt: string;
  replyCount: number;
  meckyMentioned: boolean;
  meckyAnswered: boolean;
  synthetic: true;
};

export type StagingFeedResponse = {
  schemaVersion: "roebel_staging_feed_v1";
  posts: StagingFeedPost[];
  authorityBinding: "none";
};

export type StagingThreadResponse = {
  schemaVersion: "roebel_staging_argument_thread_v1";
  arguments: StagingArgument[];
  rootEvent: StagingSignedEvent | null;
  mecky: null | {
    event: StagingSignedEvent;
    author: { name: "Mecky"; kind: "mecky"; pubkey: string };
    evidenceRefs: { digest: string; url: string }[];
  };
  authorityBinding: "none";
};

export type StagingSignedEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export type StagingPersona = {
  id: string;
  name: string;
  publicKey: string;
};

export type StagingConfigResponse = {
  schemaVersion: "roebel_e2e_workbench_config_v1";
  personas: StagingPersona[];
  meckyPubkey: string;
  authorityBinding: "none";
};

export async function stagingGet<T>(path: string): Promise<T> {
  const response = await fetch(`${STADTSTACK_STAGING_API}${path}`, { cache: "no-store" });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}

export async function stagingPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${STADTSTACK_STAGING_API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-stadtstack-e2e": "1" },
    body: JSON.stringify(body),
  });
  const value = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}
