"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, ShoppingBag, ClipboardList } from "lucide-react"
import { useActiveAccount } from "thirdweb/react"
import { useAccount } from "@/lib/context/AccountContext"
import { createListing } from "@/app/actions/marketplace"
import type {
  ListingType,
  MarketplaceCategory,
  ServiceCategory,
  BoardCategory,
  ListingCondition,
  PriceType,
  ServicePriceType,
  BoardPriceType,
} from "@/types/marketplace"
import { ListingForm } from "@/components/marketplace/ListingForm"
import { hasSupabase } from "@/lib/record"

export default function CreateListingPage() {
  const router = useRouter()
  const account = useActiveAccount()
  const { activeAccount } = useAccount()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [listingType, setListingType] = useState<ListingType>("product")

  const isServiceMode = listingType === "service"
  const isBoardMode = listingType === "schwarzes_brett"

  const handleSubmit = async (data: {
    title: string
    description: string
    price: number
    price_type: PriceType | ServicePriceType | BoardPriceType
    category: MarketplaceCategory | ServiceCategory | BoardCategory
    condition: ListingCondition | null
    neighborhood: string
    media_urls: string[]
  }) => {
    if (!account?.address) return
    setIsSubmitting(true)

    const result = await createListing({
      seller_wallet_address: account.address,
      account_id:
        activeAccount?.account_type === "organisation" ? activeAccount.id : null,
      listing_type: listingType,
      title: data.title,
      description: data.description || undefined,
      price: data.price,
      price_type: data.price_type,
      category: data.category,
      condition: data.condition || undefined,
      neighborhood: data.neighborhood || undefined,
      media_urls: data.media_urls,
    })

    if (result.success) {
      router.push("/app/marktplatz/meine")
    }
    setIsSubmitting(false)
  }

  if (!hasSupabase) {
    return (
      <div className="text-center py-12">
        <ShoppingBag className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground font-medium">
          Diese Funktion benötigt ein Backend und ist im öffentlichen Datensatz
          nicht verfügbar.
        </p>
      </div>
    )
  }

  if (!account?.address) {
    return (
      <div className="text-center py-12">
        <ShoppingBag className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground font-medium">Wallet nicht verbunden</p>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <div>
        <Link
          href="/app/marktplatz"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Marktplatz
        </Link>
        <h1 className="text-xl font-bold text-foreground">
          {isBoardMode
            ? "Aushang erstellen"
            : isServiceMode
              ? "Dienstleistung erstellen"
              : "Inserat erstellen"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isBoardMode
            ? "Erstellen Sie einen Aushang für das Schwarze Brett."
            : isServiceMode
              ? "Bieten Sie eine Dienstleistung an."
              : "Bieten Sie etwas zum Verkauf an."}
        </p>
        {activeAccount && (
          <p className="text-xs text-muted-foreground mt-2">
            Posten als <span className="font-medium text-foreground">{activeAccount.name}</span>
          </p>
        )}
      </div>

      {/* Listing Type Toggle */}
      <div className="flex bg-muted rounded-lg p-1">
        <button
          onClick={() => setListingType("product")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            listingType === "product"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Artikel verkaufen
        </button>
        <button
          onClick={() => setListingType("service")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            listingType === "service"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Dienstleistung
        </button>
        <button
          onClick={() => setListingType("schwarzes_brett")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            listingType === "schwarzes_brett"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Schwarzes Brett
        </button>
      </div>

      <div className="bg-card rounded-xl border border-border p-4">
        <ListingForm
          key={listingType}
          listingType={listingType}
          onSubmit={handleSubmit}
          onCancel={() => router.push("/app/marktplatz")}
          isSubmitting={isSubmitting}
        />
      </div>
    </div>
  )
}
