export interface UnreadNotificationCountSources {
  countBroadcastPush(after?: string): Promise<number>;
  countBroadcastActivity(after?: string): Promise<number>;
  countPersonal(walletAddress: string, after?: string): Promise<number>;
}

interface CountUnreadNotificationsOptions {
  sources: UnreadNotificationCountSources;
  after?: string;
  walletAddress?: string | null;
  cap?: number;
}

export async function countUnreadNotifications({
  sources,
  after,
  walletAddress,
  cap = 50,
}: CountUnreadNotificationsOptions): Promise<number> {
  const normalizedWallet = walletAddress?.trim().toLowerCase() || null;
  const counts = await Promise.all([
    sources.countBroadcastPush(after),
    sources.countBroadcastActivity(after),
    ...(normalizedWallet
      ? [sources.countPersonal(normalizedWallet, after)]
      : []),
  ]);

  const total = counts.reduce(
    (sum, count) => sum + (Number.isFinite(count) ? Math.max(0, count) : 0),
    0
  );
  return Math.min(total, cap);
}
