import type { FlyerCopy } from "@/lib/flyer/copy";

/** A saved flyer row (public.flyers). */
export interface Flyer {
  id: string;
  account_id: string;
  created_by_wallet: string | null;
  title: string;
  brief: string;
  copy: FlyerCopy;
  style: string;
  image_url: string;
  event_id: string | null;
  source: "brief" | "event" | string;
  status: string;
  created_at: string;
}

/** An org event offered as a prefill source in the flyer form. */
export interface FlyerEventOption {
  id: string;
  title: string;
  date: string | null;
}
