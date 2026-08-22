"use client";

import { use } from "react";
import { StadtstackCivicTopic } from "@/components/app/StadtstackCivicTopic";

export default function StadtstackCivicTopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = use(params);
  return <StadtstackCivicTopic topicId={topicId} />;
}
