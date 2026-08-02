"use client"

import { use, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import {
  ArrowLeft,
  MessageSquare,
  Pencil,
  Trash2,
  MapPin,
  Calendar,
  Eye,
  User,
  ShoppingBag,
  CheckCircle,
  Pause,
  ClipboardList,
} from "lucide-react"
import { useActiveAccount } from "thirdweb/react"
import { getListingById, deleteListing, updateListingStatus } from "@/app/actions/marketplace"
import type { ListingWithSeller, ListingStatus } from "@/types/marketplace"
import {
  formatListingPrice,
  getConditionLabel,
  getAnyCategoryLabel,
  isService,
  isBoard,
} from "@/types/marketplace"
import { MediaCarousel } from "@/components/business/MediaCarousel"
import { formatWalletAddress } from "@/lib/user-types"
import { hasSupabase } from "@/lib/record"

const conditionColors: Record<string, string> = {
  neu: "bg-green-50 text-green-700",
  wie_neu: "bg-blue-50 text-blue-700",
  gut: "bg-muted text-foreground",
  akzeptabel: "bg-amber-50 text-amber-700",
}

const statusBadge: Record<string, { bg: string; label: string }> = {
  sold: { bg: "bg-muted text-muted-foreground", label: "Verkauft" },
  reserved: { bg: "bg-amber-100 text-amber-700", label: "Reserviert" },
  paused: { bg: "bg-gray-100 text-gray-600", label: "Pausiert" },
}

export default function ListingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const account = useActiveAccount()
  const [listing, setListing] = useState<ListingWithSeller | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      const result = await getListingById(id)
      if (result.success && result.data) {
        setListing(result.data)
      } else {
        setError(result.error || "Inserat nicht gefunden")
      }
      setIsLoading(false)
    }
    load()
  }, [id])

  const isOwner =
    account?.address &&
    listing?.seller_wallet_address &&
    account.address.toLowerCase() === listing.seller_wallet_address.toLowerCase()

  const handleStatusChange = async (status: ListingStatus) => {
    if (!listing || !account?.address) return
    const result = await updateListingStatus(listing.id, account.address, status)
    if (result.success && result.data) {
      setListing({ ...listing, status: result.data.status })
    }
  }

  const handleDelete = async () => {
    if (!listing || !account?.address) return
    const result = await deleteListing(listing.id, account.address)
    if (result.success) {
      router.push("/app/marktplatz/meine")
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto animate-pulse space-y-4">
        <div className="h-6 bg-muted rounded w-1/4" />
        <div className="h-64 bg-muted rounded-lg" />
        <div className="h-8 bg-muted rounded w-1/2" />
        <div className="h-5 bg-muted rounded w-1/3" />
        <div className="h-20 bg-muted rounded" />
      </div>
    )
  }

  if (error || !listing) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <ShoppingBag className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground font-medium">{error || "Inserat nicht gefunden"}</p>
        <Link
          href="/app/marktplatz"
          className="inline-flex items-center gap-1 mt-4 text-sm text-primary hover:text-primary/80"
        >
          <ArrowLeft className="h-4 w-4" />
          Zurück zum Marktplatz
        </Link>
      </div>
    )
  }

  const isServiceListing = isService(listing)
  const isBoardListing = isBoard(listing)

  const createdDate = new Date(listing.created_at).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

  // For board listings, "sold" means "erledigt" (resolved)
  const getStatusDisplayLabel = (status: string) => {
    if (isBoardListing && status === "sold") return "Erledigt"
    return statusBadge[status]?.label
  }

  const getStatusDisplayBg = (status: string) => {
    if (isBoardListing && status === "sold") return "bg-green-100 text-green-700"
    return statusBadge[status]?.bg
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Back link */}
      <Link
        href="/app/marktplatz"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Marktplatz
      </Link>

      {/* Media */}
      {listing.media_urls.length > 0 ? (
        <div className="rounded-lg overflow-hidden">
          <MediaCarousel
            images={listing.media_urls}
            alt={listing.title}
            height="h-64 sm:h-80"
          />
        </div>
      ) : (
        <div className="h-48 bg-muted rounded-lg flex items-center justify-center">
          {isBoardListing ? (
            <ClipboardList className="h-12 w-12 text-muted-foreground" />
          ) : (
            <ShoppingBag className="h-12 w-12 text-muted-foreground" />
          )}
        </div>
      )}

      {/* Main info */}
      <div className="bg-card rounded-lg border border-border p-4">
        {/* Status badge for sold/reserved/paused */}
        {listing.status !== "active" && getStatusDisplayLabel(listing.status) && (
          <span
            className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full mb-2 ${getStatusDisplayBg(listing.status)}`}
          >
            {getStatusDisplayLabel(listing.status)}
          </span>
        )}

        {/* Badges */}
        <div className="flex items-center gap-2 mb-2">
          {isBoardListing && (
            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
              Schwarzes Brett
            </span>
          )}
          {!isServiceListing && !isBoardListing && listing.condition && (
            <span
              className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                conditionColors[listing.condition] || "bg-muted text-foreground"
              }`}
            >
              {getConditionLabel(listing.condition)}
            </span>
          )}
          {isServiceListing && (
            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-700">
              Dienstleistung
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {getAnyCategoryLabel(listing.category)}
          </span>
        </div>

        {/* Title + Price */}
        <h1 className="text-xl font-bold text-foreground">{listing.title}</h1>
        <p className="text-2xl font-bold text-foreground mt-1">
          {formatListingPrice(listing.price, listing.price_type, listing.listing_type)}
        </p>

        {/* Description */}
        {listing.description && (
          <p className="text-sm text-muted-foreground mt-3 whitespace-pre-line">{listing.description}</p>
        )}

        {/* Meta */}
        <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
          {(listing.neighborhood || listing.seller_neighborhood) && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {listing.neighborhood || listing.seller_neighborhood}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {createdDate}
          </span>
          <span className="flex items-center gap-1">
            <Eye className="h-3.5 w-3.5" />
            {listing.views_count} Aufrufe
          </span>
        </div>
      </div>

      {/* Seller card */}
      <div className="bg-card rounded-lg border border-border p-4">
        <p className="text-xs text-muted-foreground mb-3">
          {isBoardListing ? "Ersteller" : isServiceListing ? "Anbieter" : "Verkäufer"}
        </p>
        <div className="flex items-center gap-3">
          <Link
            href={`/app/profile/${listing.seller_wallet_address}`}
            className="w-10 h-10 rounded-full bg-muted overflow-hidden flex items-center justify-center flex-shrink-0"
          >
            {listing.seller_profile_picture_url ? (
              <Image
                src={listing.seller_profile_picture_url}
                alt={listing.seller_username || formatWalletAddress(listing.seller_wallet_address)}
                width={40}
                height={40}
                className="object-cover w-full h-full"
              />
            ) : (
              <User className="h-5 w-5 text-muted-foreground" />
            )}
          </Link>
          <div className="min-w-0 flex-1">
            <Link
              href={`/app/profile/${listing.seller_wallet_address}`}
              className="text-sm font-medium text-foreground hover:text-primary transition-colors"
            >
              {listing.seller_username || formatWalletAddress(listing.seller_wallet_address)}
            </Link>
            {listing.seller_neighborhood && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {listing.seller_neighborhood}
              </p>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-4">
          {isOwner ? (
            <div className="space-y-2">
              <Link
                href={`/app/marktplatz/${listing.id}/bearbeiten`}
                className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                <Pencil className="h-4 w-4" />
                Bearbeiten
              </Link>
              <div className="grid grid-cols-2 gap-2">
                {isBoardListing ? (
                  <>
                    {listing.status === "active" && (
                      <>
                        <button
                          onClick={() => handleStatusChange("sold")}
                          className="flex items-center justify-center gap-1.5 py-2 bg-green-50 hover:bg-green-100 text-green-700 text-sm font-medium rounded-lg transition-colors"
                        >
                          <CheckCircle className="h-4 w-4" />
                          Erledigt
                        </button>
                        <button
                          onClick={() => handleStatusChange("paused")}
                          className="flex items-center justify-center gap-1.5 py-2 bg-muted hover:bg-accent text-foreground text-sm font-medium rounded-lg transition-colors"
                        >
                          <Pause className="h-4 w-4" />
                          Pausieren
                        </button>
                      </>
                    )}
                    {(listing.status === "sold" || listing.status === "paused") && (
                      <button
                        onClick={() => handleStatusChange("active")}
                        className="flex items-center justify-center gap-1.5 py-2 bg-green-50 hover:bg-green-100 text-green-700 text-sm font-medium rounded-lg transition-colors col-span-2"
                      >
                        Wieder aktivieren
                      </button>
                    )}
                  </>
                ) : isServiceListing ? (
                  <>
                    {listing.status === "active" && (
                      <button
                        onClick={() => handleStatusChange("paused")}
                        className="flex items-center justify-center gap-1.5 py-2 bg-muted hover:bg-accent text-foreground text-sm font-medium rounded-lg transition-colors col-span-2"
                      >
                        <Pause className="h-4 w-4" />
                        Pausieren
                      </button>
                    )}
                    {listing.status === "paused" && (
                      <button
                        onClick={() => handleStatusChange("active")}
                        className="flex items-center justify-center gap-1.5 py-2 bg-green-50 hover:bg-green-100 text-green-700 text-sm font-medium rounded-lg transition-colors col-span-2"
                      >
                        Wieder aktivieren
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {listing.status === "active" && (
                      <>
                        <button
                          onClick={() => handleStatusChange("sold")}
                          className="flex items-center justify-center gap-1.5 py-2 bg-muted hover:bg-accent text-foreground text-sm font-medium rounded-lg transition-colors"
                        >
                          <CheckCircle className="h-4 w-4" />
                          Verkauft
                        </button>
                        <button
                          onClick={() => handleStatusChange("reserved")}
                          className="flex items-center justify-center gap-1.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 text-sm font-medium rounded-lg transition-colors"
                        >
                          Reservieren
                        </button>
                      </>
                    )}
                    {(listing.status === "sold" || listing.status === "reserved") && (
                      <button
                        onClick={() => handleStatusChange("active")}
                        className="flex items-center justify-center gap-1.5 py-2 bg-green-50 hover:bg-green-100 text-green-700 text-sm font-medium rounded-lg transition-colors col-span-2"
                      >
                        Wieder aktivieren
                      </button>
                    )}
                  </>
                )}
              </div>
              <button
                onClick={handleDelete}
                className="flex items-center justify-center gap-1.5 w-full py-2 text-red-600 hover:bg-red-50 text-sm font-medium rounded-lg transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                {isBoardListing
                  ? "Aushang löschen"
                  : isServiceListing
                    ? "Dienstleistung löschen"
                    : "Inserat löschen"}
              </button>
            </div>
          ) : !hasSupabase ? null : (
            <Link
              href={`/app/messages?to=${listing.seller_wallet_address}&subject=${encodeURIComponent(listing.title)}&listingId=${listing.id}`}
              className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              <MessageSquare className="h-4 w-4" />
              Nachricht senden
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
