export interface ExpoMiniAppMessageRoute {
  activeSourceUrl: string;
  messageUrl: string;
  data: string;
  deliver: (data: string) => void;
}

/**
 * Routes a WebView bridge message only when it came from the origin currently
 * loaded by the host. The caller still owns bridge construction and queuing;
 * this module owns the transport trust boundary shared by both paths.
 */
export function routeExpoMiniAppMessage({
  activeSourceUrl,
  messageUrl,
  data,
  deliver,
}: ExpoMiniAppMessageRoute): boolean {
  try {
    const active = new URL(activeSourceUrl);
    const sender = new URL(messageUrl);
    if (active.origin === "null" || sender.origin !== active.origin) return false;
  } catch {
    return false;
  }

  deliver(data);
  return true;
}
