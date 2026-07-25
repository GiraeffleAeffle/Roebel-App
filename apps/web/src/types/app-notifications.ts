export type AppNotificationType =
  | "event_new"
  | "news_new"
  | "business_new"
  | "listing_new"
  | "post_new"
  | "proposal_new"
  | "deal_new"
  | "alert_new"
  | "story_new"

export interface AppNotification {
  id: string
  type: AppNotificationType
  title: string
  body: string | null
  link: string | null
  reference_id: string | null
  image_url: string | null
  created_at: string
}

export interface UnifiedNotification {
  id: string
  source: "push" | "activity" | "personal"
  title: string
  body: string | null
  type: string
  link: string | null
  image_url: string | null
  created_at: string
}
