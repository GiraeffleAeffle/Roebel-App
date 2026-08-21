"use client";

import { use } from "react";
import { StadtstackDiscussion } from "@/components/app/StadtstackDiscussion";

export default function StadtstackDiscussionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <StadtstackDiscussion rootId={id} />;
}
