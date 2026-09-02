"use client";

import { use } from "react";
import { StadtstackCivicTopic } from "@/components/app/StadtstackCivicTopic";
import { civicTopicIdFromRouteParam } from "@/lib/stadtstack/civic-topic-route";

export default function StadtstackCivicTopicPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId: routeParam } = use(params);
  return (
    <StadtstackCivicTopic topicId={civicTopicIdFromRouteParam(routeParam)} />
  );
}
