"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { useActiveAccount } from "thirdweb/react"
import { useAccount } from "@/lib/context/AccountContext"
import {
  getAccountRole,
  canManageMembers,
  canLeaveOrg,
  updateMemberRole,
  type AccountRole,
} from "@/lib/supabase-account-roles"
import {
  fetchMembersWithProfiles,
  removeMember as removeMemberDB,
  leaveOrg as leaveOrgDB,
  searchUsersForInvite,
} from "@/lib/supabase-member-management"
import {
  fetchPendingInvites,
  revokeInvite as revokeInviteDB,
  createInAppInvite,
  createLinkInvite,
  hasPendingInvite,
} from "@/lib/supabase-invites"
import type {
  MemberWithProfile,
  InviteTokenWithUser,
  OrgRole,
} from "@/types/account"
import {
  ArrowLeft,
  UserPlus,
  MoreVertical,
  Shield,
  UserMinus,
  Link2,
  Search,
  Copy,
  Share2,
  Loader2,
} from "lucide-react"

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Inhaber",
  admin: "Admin",
  member: "Mitglied",
}

const ROLE_STYLES: Record<OrgRole, string> = {
  owner: "bg-[#00498B] text-white",
  admin: "bg-blue-100 text-[#00498B] dark:bg-blue-900/30 dark:text-blue-300",
  member: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
}

export default function OrgManagePage() {
  const router = useRouter()
  const thirdwebAccount = useActiveAccount()
  const walletAddress = thirdwebAccount?.address
  const { activeAccount, refreshAccounts } = useAccount()
  const accountId = activeAccount?.id

  const [members, setMembers] = useState<MemberWithProfile[]>([])
  const [pendingInvites, setPendingInvites] = useState<InviteTokenWithUser[]>([])
  const [currentRole, setCurrentRole] = useState<AccountRole | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  // Invite state
  const [showInvite, setShowInvite] = useState(false)
  const [inviteTab, setInviteTab] = useState<"app" | "link">("app")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member")
  const [expiryDays, setExpiryDays] = useState(7)
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const ownerCount = members.filter((m) => m.role === "owner").length
  const canManage = canManageMembers(currentRole)
  const canLeave = canLeaveOrg(currentRole, ownerCount)

  const load = useCallback(async () => {
    if (!accountId || !walletAddress) return
    const [membersData, invitesData, role] = await Promise.all([
      fetchMembersWithProfiles(accountId),
      fetchPendingInvites(accountId),
      getAccountRole(accountId, walletAddress),
    ])
    setMembers(membersData)
    setPendingInvites(invitesData)
    setCurrentRole(role)
  }, [accountId, walletAddress])

  useEffect(() => {
    setIsLoading(true)
    load().finally(() => setIsLoading(false))
  }, [load])

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    setSelectedUser(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.length < 2) { setSearchResults([]); return }
    debounceRef.current = setTimeout(async () => {
      const results = await searchUsersForInvite(query, members.map((m) => m.wallet_address))
      setSearchResults(results)
    }, 300)
  }

  const handleSendInvite = async () => {
    if (!selectedUser || !walletAddress || !accountId) return
    setIsSending(true)
    try {
      const exists = await hasPendingInvite(accountId, selectedUser.wallet_address)
      if (exists) { alert("Dieser Benutzer hat bereits eine ausstehende Einladung."); return }
      await createInAppInvite(accountId, selectedUser.wallet_address, inviteRole, walletAddress)
      setShowInvite(false)
      setSelectedUser(null)
      setSearchQuery("")
      await load()
    } catch (e: any) {
      alert(e?.message || "Fehler beim Senden der Einladung")
    } finally {
      setIsSending(false)
    }
  }

  const handleCreateLink = async () => {
    if (!walletAddress || !accountId) return
    setIsSending(true)
    try {
      const invite = await createLinkInvite(accountId, inviteRole, walletAddress, expiryDays)
      setGeneratedLink(`https://roebel.app/invite/${invite.token}`)
      await load()
    } catch (e: any) {
      alert(e?.message || "Fehler beim Erstellen des Links")
    } finally {
      setIsSending(false)
    }
  }

  const handleRevoke = async (inviteId: string) => {
    if (!confirm("Einladung wirklich widerrufen?")) return
    await revokeInviteDB(inviteId)
    await load()
  }

  const handleRemoveMember = async (wallet: string, name: string) => {
    if (!accountId || !thirdwebAccount || !confirm(`${name} wirklich entfernen?`)) return
    await removeMemberDB(thirdwebAccount, accountId, wallet)
    await load()
  }

  const handleChangeRole = async (wallet: string, newRole: OrgRole) => {
    if (!accountId) return
    await updateMemberRole(accountId, wallet, newRole as AccountRole)
    setMenuOpen(null)
    await load()
  }

  const handleLeave = async () => {
    if (!accountId || !thirdwebAccount) return
    if (!confirm(`${activeAccount?.name || "Organisation"} wirklich verlassen?`)) return
    await leaveOrgDB(thirdwebAccount, accountId)
    await refreshAccounts()
    router.push("/app")
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto p-6 flex justify-center items-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 hover:bg-accent rounded-lg">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-semibold">Mitglieder verwalten</h1>
        </div>
        {canManage && (
          <button
            onClick={() => { setShowInvite(true); setGeneratedLink(null); setInviteTab("app") }}
            className="flex items-center gap-2 px-4 py-2 bg-[#00498B] text-white rounded-lg text-sm font-medium hover:bg-[#143a72] transition-colors"
          >
            <UserPlus className="h-4 w-4" />
            Einladen
          </button>
        )}
      </div>

      {/* Member List */}
      <div className="space-y-2">
        {members.map((member) => {
          const displayName = member.user?.username || `${member.wallet_address.slice(0, 6)}...${member.wallet_address.slice(-4)}`
          const joinedDate = new Date(member.joined_at).toLocaleDateString("de-DE", { day: "numeric", month: "long" })
          const isOwner = member.role === "owner"

          return (
            <div key={member.wallet_address} className="flex items-center gap-3 p-3 bg-card rounded-xl border border-border relative">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                {member.user?.profile_picture_url ? (
                  <img src={member.user.profile_picture_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  displayName.slice(0, 2).toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{displayName}</p>
                <p className="text-xs text-muted-foreground">Beigetreten {joinedDate}</p>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${ROLE_STYLES[member.role]}`}>
                {ROLE_LABELS[member.role]}
              </span>
              {canManage && !isOwner && (
                <div className="relative">
                  <button onClick={() => setMenuOpen(menuOpen === member.wallet_address ? null : member.wallet_address)} className="p-1 hover:bg-accent rounded">
                    <MoreVertical className="h-4 w-4 text-muted-foreground" />
                  </button>
                  {menuOpen === member.wallet_address && (
                    <div className="absolute right-0 top-8 bg-card border border-border rounded-lg shadow-lg z-10 min-w-[180px]">
                      <button
                        onClick={() => handleChangeRole(member.wallet_address, member.role === "admin" ? "member" : "admin")}
                        className="flex items-center gap-2 w-full px-4 py-2.5 text-sm hover:bg-accent text-left"
                      >
                        <Shield className="h-4 w-4" />
                        {member.role === "admin" ? "Zum Mitglied ändern" : "Zum Admin befördern"}
                      </button>
                      <button
                        onClick={() => { setMenuOpen(null); handleRemoveMember(member.wallet_address, displayName) }}
                        className="flex items-center gap-2 w-full px-4 py-2.5 text-sm hover:bg-accent text-left text-red-600"
                      >
                        <UserMinus className="h-4 w-4" />
                        Entfernen
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Ausstehende Einladungen</h3>
          {pendingInvites.map((invite) => {
            const isLinkInvite = !invite.invited_wallet
            const displayName = invite.invited_user?.username || (isLinkInvite ? "Einladungslink" : `${invite.invited_wallet?.slice(0, 8)}...`)
            const daysLeft = Math.max(0, Math.ceil((new Date(invite.expires_at).getTime() - Date.now()) / 86400000))

            return (
              <div key={invite.id} className="flex items-center gap-3 p-3 bg-card rounded-xl border border-border opacity-70">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm">
                  {isLinkInvite ? <Link2 className="h-4 w-4" /> : displayName.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{displayName}</p>
                  <p className="text-xs text-muted-foreground">Läuft ab in {daysLeft} {daysLeft === 1 ? "Tag" : "Tagen"}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${ROLE_STYLES[invite.role]}`}>
                  {ROLE_LABELS[invite.role]}
                </span>
                {canManage && (
                  <button onClick={() => handleRevoke(invite.id)} className="text-xs text-red-600 hover:text-red-700 font-medium border border-red-200 px-2 py-1 rounded">
                    Widerrufen
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Leave Org */}
      {canLeave && (
        <button onClick={handleLeave} className="w-full text-center text-sm text-red-600 hover:text-red-700 py-3 font-medium">
          Organisation verlassen
        </button>
      )}

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center" onClick={() => setShowInvite(false)}>
          <div className="bg-card rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">Mitglied einladen</h2>

            {/* Tabs */}
            <div className="flex bg-muted rounded-lg p-1">
              <button onClick={() => { setInviteTab("app"); setGeneratedLink(null) }} className={`flex-1 py-2 text-sm rounded-md ${inviteTab === "app" ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}>
                In der App
              </button>
              <button onClick={() => { setInviteTab("link"); setGeneratedLink(null) }} className={`flex-1 py-2 text-sm rounded-md ${inviteTab === "link" ? "bg-card shadow-sm font-medium" : "text-muted-foreground"}`}>
                Per Link
              </button>
            </div>

            {inviteTab === "app" ? (
              <>
                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Name suchen..."
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-border rounded-lg bg-background text-sm"
                  />
                </div>

                {selectedUser && (
                  <div className="flex items-center gap-2 bg-muted rounded-lg p-2">
                    <span className="text-sm font-medium flex-1">{selectedUser.username}</span>
                    <button onClick={() => setSelectedUser(null)} className="text-muted-foreground hover:text-foreground">✕</button>
                  </div>
                )}

                {!selectedUser && searchQuery.length >= 2 && (
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {searchResults.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-3">Keine Ergebnisse</p>
                    ) : searchResults.map((user) => (
                      <button key={user.wallet_address} onClick={() => { setSelectedUser(user); setSearchQuery(""); setSearchResults([]) }}
                        className="flex items-center gap-2 w-full p-2 hover:bg-accent rounded-lg text-left">
                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs">
                          {user.username?.charAt(0).toUpperCase() || "?"}
                        </div>
                        <span className="text-sm">{user.username}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Role Picker */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Rolle zuweisen</p>
                  <div className="flex gap-2">
                    {(["admin", "member"] as const).map((r) => (
                      <button key={r} onClick={() => setInviteRole(r)}
                        className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors ${inviteRole === r ? "border-[#00498B] bg-blue-50 text-[#00498B] dark:bg-blue-900/20 dark:border-blue-400 dark:text-blue-300" : "border-border text-muted-foreground"}`}>
                        {ROLE_LABELS[r]}
                      </button>
                    ))}
                  </div>
                </div>

                <button onClick={handleSendInvite} disabled={!selectedUser || isSending}
                  className="w-full py-3 bg-[#00498B] text-white rounded-lg font-medium disabled:opacity-50 hover:bg-[#143a72] transition-colors">
                  {isSending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Einladung senden"}
                </button>
              </>
            ) : (
              <>
                {!generatedLink ? (
                  <>
                    {/* Role Picker */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">Rolle zuweisen</p>
                      <div className="flex gap-2">
                        {(["admin", "member"] as const).map((r) => (
                          <button key={r} onClick={() => setInviteRole(r)}
                            className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-colors ${inviteRole === r ? "border-[#00498B] bg-blue-50 text-[#00498B] dark:bg-blue-900/20 dark:border-blue-400 dark:text-blue-300" : "border-border text-muted-foreground"}`}>
                            {ROLE_LABELS[r]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Expiry */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">Gültig für</p>
                      <div className="flex gap-2">
                        {[{ label: "24 Std.", days: 1 }, { label: "7 Tage", days: 7 }, { label: "30 Tage", days: 30 }].map((opt) => (
                          <button key={opt.days} onClick={() => setExpiryDays(opt.days)}
                            className={`flex-1 py-2 rounded-lg border text-sm transition-colors ${expiryDays === opt.days ? "border-[#00498B] bg-blue-50 text-[#00498B] dark:bg-blue-900/20 dark:border-blue-400 dark:text-blue-300" : "border-border text-muted-foreground"}`}>
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button onClick={handleCreateLink} disabled={isSending}
                      className="w-full py-3 bg-[#00498B] text-white rounded-lg font-medium disabled:opacity-50 hover:bg-[#143a72] transition-colors">
                      {isSending ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : "Link erstellen"}
                    </button>
                    <p className="text-xs text-center text-muted-foreground">Link kann nur einmal verwendet werden</p>
                  </>
                ) : (
                  <>
                    <div className="p-3 bg-muted rounded-lg border border-border text-sm break-all">{generatedLink}</div>
                    <div className="flex gap-2">
                      <button onClick={() => { navigator.clipboard.writeText(generatedLink); alert("Link kopiert!") }}
                        className="flex-1 flex items-center justify-center gap-2 py-3 border border-border rounded-lg text-sm font-medium hover:bg-accent transition-colors">
                        <Copy className="h-4 w-4" /> Kopieren
                      </button>
                      <button onClick={() => navigator.share?.({ url: generatedLink }).catch(() => {})}
                        className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#00498B] text-white rounded-lg text-sm font-medium hover:bg-[#143a72] transition-colors">
                        <Share2 className="h-4 w-4" /> Teilen
                      </button>
                    </div>
                    <p className="text-xs text-center text-muted-foreground">Link kann nur einmal verwendet werden</p>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
