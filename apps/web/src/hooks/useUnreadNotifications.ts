"use client"

import { useState, useEffect, useCallback } from "react"
import { useActiveAccount } from "thirdweb/react"
import { startVisiblePoller } from "@/lib/visible-poller"
import {
  LAST_VIEWED_NOTIFICATIONS_KEY,
  NOTIFICATIONS_VIEWED_EVENT,
} from "@/lib/notifications/client-state"

export function useUnreadNotifications(pollingInterval: number = 60000) {
  const account = useActiveAccount()
  const walletAddress = account?.address ?? null
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const fetchUnreadCount = useCallback(
    async (signal: AbortSignal) => {
      try {
        const params = new URLSearchParams()
        const lastViewed = localStorage.getItem(LAST_VIEWED_NOTIFICATIONS_KEY)
        if (lastViewed) {
          const parsed = new Date(lastViewed)
          if (!Number.isNaN(parsed.getTime())) {
            params.set("since", parsed.toISOString())
          }
        }
        if (walletAddress) params.set("wallet", walletAddress)

        const query = params.toString()
        const response = await fetch(`/api/notifications/unread-count${query ? `?${query}` : ""}`, {
          cache: "no-store",
          signal,
        })
        if (!response.ok) {
          throw new Error("Unread count failed: " + response.status)
        }

        const result = (await response.json()) as { count?: unknown }
        if (
          typeof result.count !== "number" ||
          !Number.isFinite(result.count)
        ) {
          throw new Error("Unread count response was invalid")
        }
        if (!signal.aborted) {
          setUnreadCount(Math.max(0, Math.floor(result.count)))
        }
      } finally {
        if (!signal.aborted) setIsLoading(false)
      }
    },
    [walletAddress]
  )

  useEffect(() => {
    const poller = startVisiblePoller({
      intervalMs: pollingInterval,
      poll: fetchUnreadCount,
      scheduler: {
        setTimeout: (callback, delayMs) =>
          window.setTimeout(callback, delayMs),
        clearTimeout: (handle) => window.clearTimeout(handle as number),
      },
      visibility: {
        get hidden() {
          return document.hidden
        },
        addEventListener: (_type, listener) =>
          document.addEventListener("visibilitychange", listener),
        removeEventListener: (_type, listener) =>
          document.removeEventListener("visibilitychange", listener),
      },
    })

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LAST_VIEWED_NOTIFICATIONS_KEY) poller.refresh()
    }
    const handleViewed = () => poller.refresh()
    window.addEventListener("storage", handleStorage)
    window.addEventListener(NOTIFICATIONS_VIEWED_EVENT, handleViewed)

    return () => {
      poller.stop()
      window.removeEventListener("storage", handleStorage)
      window.removeEventListener(NOTIFICATIONS_VIEWED_EVENT, handleViewed)
    }
  }, [fetchUnreadCount, pollingInterval])

  return { unreadCount, isLoading }
}
