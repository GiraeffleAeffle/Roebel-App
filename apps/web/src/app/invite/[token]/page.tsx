"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useActiveAccount } from "thirdweb/react"
import {
  fetchInviteByToken,
  acceptInvite,
  declineInvite,
} from "@/lib/supabase-invites"
import { isAccountOwner } from "@/lib/supabase-accounts"
import type { InviteTokenWithAccount } from "@/types/account"
import { SUB_TYPE_LABELS } from "@/types/account"
import { Loader2, CheckCircle, XCircle, Clock, AlertTriangle } from "lucide-react"

export default function InviteTokenPage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const thirdwebAccount = useActiveAccount()
  const walletAddress = thirdwebAccount?.address

  const [invite, setInvite] = useState<InviteTokenWithAccount | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isExpired, setIsExpired] = useState(false)
  const [isAlreadyMember, setIsAlreadyMember] = useState(false)
  const [resolved, setResolved] = useState<"accepted" | "declined" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isAccepting, setIsAccepting] = useState(false)
  const [isDeclining, setIsDeclining] = useState(false)

  useEffect(() => {
    if (!token) return

    setIsLoading(true)
    fetchInviteByToken(token)
      .then(async (data) => {
        if (!data) {
          setError("Einladung nicht gefunden oder ungültig")
          return
        }

        setInvite(data)

        if (new Date(data.expires_at) < new Date() || data.status === "expired") {
          setIsExpired(true)
          return
        }

        if (data.status !== "pending") {
          setResolved(data.status === "accepted" ? "accepted" : "declined")
          return
        }

        if (walletAddress) {
          const isMember = await isAccountOwner(data.account_id, walletAddress)
          setIsAlreadyMember(isMember)
        }
      })
      .catch(() => setError("Einladung konnte nicht geladen werden"))
      .finally(() => setIsLoading(false))
  }, [token, walletAddress])

  const handleAccept = async () => {
    if (!invite || !thirdwebAccount) return
    setIsAccepting(true)
    try {
      await acceptInvite(thirdwebAccount, invite.id)
      setResolved("accepted")
    } catch (err: any) {
      setError(err?.message || "Fehler beim Annehmen")
    } finally {
      setIsAccepting(false)
    }
  }

  const handleDecline = async () => {
    if (!invite || !thirdwebAccount) return
    setIsDeclining(true)
    try {
      await declineInvite(thirdwebAccount, invite.id)
      setResolved("declined")
    } catch (err: any) {
      setError(err?.message || "Fehler beim Ablehnen")
    } finally {
      setIsDeclining(false)
    }
  }

  const ROLE_LABELS: Record<string, string> = { admin: "Admin", member: "Mitglied" }
  const ROLE_STYLES: Record<string, string> = {
    admin: "bg-blue-100 text-[#00498B]",
    member: "bg-gray-100 text-gray-600",
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center max-w-sm space-y-4">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
          <h1 className="text-xl font-semibold">Einladung ungültig</h1>
          <p className="text-muted-foreground">{error}</p>
          <button onClick={() => router.push("/")} className="text-sm text-[#00498B] font-medium hover:underline">
            Zur Startseite
          </button>
        </div>
      </div>
    )
  }

  const account = invite?.account
  const orgTypeLabel = account?.sub_type ? SUB_TYPE_LABELS[account.sub_type] || "Organisation" : "Organisation"
  const expiryDate = invite ? new Date(invite.expires_at).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }) : ""

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-6">
        {/* Org Info */}
        <div className="text-center space-y-2">
          {account?.avatar_url ? (
            <img src={account.avatar_url} alt="" className="w-20 h-20 rounded-full mx-auto object-cover" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center mx-auto text-3xl">
              🏢
            </div>
          )}
          <h1 className="text-2xl font-bold">{account?.name}</h1>
          <p className="text-muted-foreground text-sm">{orgTypeLabel}</p>
          {account?.is_verified && (
            <p className="text-sm text-[#00498B] font-medium">Verifiziert ✓</p>
          )}
        </div>

        {/* Invite Details */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div>
            <p className="text-xs text-muted-foreground">Eingeladen als</p>
            <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-md mt-1 ${ROLE_STYLES[invite?.role || "member"]}`}>
              {ROLE_LABELS[invite?.role || "member"]}
            </span>
          </div>
          {invite?.inviter && (
            <div>
              <p className="text-xs text-muted-foreground">Eingeladen von</p>
              <p className="text-sm font-medium mt-1">
                {invite.inviter.username || invite.invited_by.slice(0, 12) + "..."}
              </p>
            </div>
          )}
        </div>

        {/* Status / Actions */}
        {isExpired ? (
          <div className="text-center space-y-2 py-4">
            <Clock className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">Diese Einladung ist abgelaufen</p>
          </div>
        ) : isAlreadyMember ? (
          <div className="text-center space-y-2 py-4">
            <CheckCircle className="h-10 w-10 text-green-500 mx-auto" />
            <p className="text-muted-foreground">Du bist bereits Mitglied dieser Organisation</p>
          </div>
        ) : resolved ? (
          <div className="text-center space-y-2 py-4">
            {resolved === "accepted" ? (
              <CheckCircle className="h-10 w-10 text-green-500 mx-auto" />
            ) : (
              <XCircle className="h-10 w-10 text-muted-foreground mx-auto" />
            )}
            <p className="text-muted-foreground">
              {resolved === "accepted" ? "Einladung angenommen" : "Einladung abgelehnt"}
            </p>
            {resolved === "accepted" && (
              <button onClick={() => router.push("/app")} className="text-sm text-[#00498B] font-medium hover:underline">
                Zur App →
              </button>
            )}
          </div>
        ) : !walletAddress ? (
          <div className="text-center space-y-3 py-4">
            <p className="text-sm text-muted-foreground">Melde dich an, um diese Einladung anzunehmen</p>
            <button onClick={() => router.push("/app")} className="w-full py-3 bg-[#00498B] text-white rounded-xl font-medium hover:bg-[#143a72] transition-colors">
              Anmelden
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={handleAccept}
              disabled={isAccepting || isDeclining}
              className="w-full py-3 bg-[#00498B] text-white rounded-xl font-medium hover:bg-[#143a72] transition-colors disabled:opacity-50"
            >
              {isAccepting ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Annehmen"}
            </button>
            <button
              onClick={handleDecline}
              disabled={isAccepting || isDeclining}
              className="w-full py-3 border border-border rounded-xl font-medium text-muted-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              {isDeclining ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Ablehnen"}
            </button>
          </div>
        )}

        {/* Expiry */}
        {!isExpired && !resolved && invite && (
          <p className="text-xs text-center text-muted-foreground">Gültig bis {expiryDate}</p>
        )}

        {/* Error */}
        {error && invite && (
          <p className="text-xs text-center text-red-600">{error}</p>
        )}
      </div>
    </div>
  )
}
