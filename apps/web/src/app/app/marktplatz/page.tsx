"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { ShoppingBag, Search, Plus, ClipboardList } from "lucide-react"
import { getActiveListings } from "@/app/actions/marketplace"
import type { ListingWithSeller } from "@/types/marketplace"
import type { MarketplaceCategory, ServiceCategory, BoardCategory, ListingCondition, ListingType } from "@/types/marketplace"
import { MARKETPLACE_CATEGORIES, SERVICE_CATEGORIES, BOARD_CATEGORIES, LISTING_CONDITIONS } from "@/types/marketplace"
import { ListingCard } from "@/components/marketplace/ListingCard"
import { hasSupabase } from "@/lib/record"

export default function MarktplatzPage() {
  const searchParams = useSearchParams()
  const tabParam = searchParams.get("tab")

  const [listings, setListings] = useState<ListingWithSeller[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [listingType, setListingType] = useState<ListingType>(() => {
    if (tabParam === "brett") return "schwarzes_brett"
    if (tabParam === "service") return "service"
    return "product"
  })
  const [categoryFilter, setCategoryFilter] = useState<MarketplaceCategory | ServiceCategory | BoardCategory | "">("")
  const [conditionFilter, setConditionFilter] = useState<ListingCondition | "">("")
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      const result = await getActiveListings(
        categoryFilter || undefined,
        conditionFilter || undefined,
        debouncedSearch || undefined,
        50,
        listingType
      )
      if (result.success && result.data) {
        setListings(result.data)
      }
      setIsLoading(false)
    }
    load()
  }, [categoryFilter, conditionFilter, debouncedSearch, listingType])

  const handleTabChange = (type: ListingType) => {
    setListingType(type)
    setCategoryFilter("")
    setConditionFilter("")
    setSearchQuery("")
  }

  const isServiceMode = listingType === "service"
  const isBoardMode = listingType === "schwarzes_brett"
  const categories = isBoardMode
    ? BOARD_CATEGORIES
    : isServiceMode
      ? SERVICE_CATEGORIES
      : MARKETPLACE_CATEGORIES

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            {isBoardMode ? (
              <ClipboardList className="h-6 w-6" />
            ) : (
              <ShoppingBag className="h-6 w-6" />
            )}
            {isBoardMode ? "Schwarzes Brett" : "Marktplatz"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isBoardMode
              ? "Gesuche, Angebote und Aushänge aus Ihrer Nachbarschaft."
              : isServiceMode
                ? "Dienstleistungen in Ihrer Nachbarschaft."
                : "Kaufen und verkaufen in Ihrer Nachbarschaft."}
          </p>
        </div>
        {hasSupabase && (
          <Link
            href="/app/marktplatz/erstellen"
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            {isBoardMode
              ? "Aushang erstellen"
              : isServiceMode
                ? "Dienstleistung anbieten"
                : "Inserat erstellen"}
          </Link>
        )}
      </div>

      {/* Listing Type Tabs */}
      <div className="flex bg-muted rounded-lg p-1">
        <button
          onClick={() => handleTabChange("product")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            listingType === "product"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Artikel
        </button>
        <button
          onClick={() => handleTabChange("service")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            listingType === "service"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Dienstleistungen
        </button>
        <button
          onClick={() => handleTabChange("schwarzes_brett")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            listingType === "schwarzes_brett"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Schwarzes Brett
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={
            isBoardMode
              ? "Schwarzes Brett durchsuchen..."
              : isServiceMode
                ? "Dienstleistungen durchsuchen..."
                : "Artikel durchsuchen..."
          }
          className="w-full pl-10 pr-4 py-2.5 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
        />
      </div>

      {/* Category filters */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          onClick={() => setCategoryFilter("")}
          className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
            categoryFilter === ""
              ? "bg-black text-white"
              : "bg-muted text-muted-foreground hover:bg-accent"
          }`}
        >
          Alle
        </button>
        {categories.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setCategoryFilter(cat.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
              categoryFilter === cat.value
                ? "bg-black text-white"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Condition filters - only for products */}
      {!isServiceMode && !isBoardMode && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            onClick={() => setConditionFilter("")}
            className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
              conditionFilter === ""
                ? "bg-black text-white"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }`}
          >
            Alle Zustände
          </button>
          {LISTING_CONDITIONS.map((c) => (
            <button
              key={c.value}
              onClick={() => setConditionFilter(c.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
                conditionFilter === c.value
                  ? "bg-black text-white"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Listings Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-card rounded-lg border border-border overflow-hidden animate-pulse">
              <div className="h-40 bg-muted" />
              <div className="p-3 space-y-2">
                <div className="h-4 bg-muted rounded w-1/4" />
                <div className="h-4 bg-muted rounded w-2/3" />
                <div className="h-5 bg-muted rounded w-1/3" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : listings.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          {isBoardMode ? (
            <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          ) : (
            <ShoppingBag className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          )}
          <p className="text-muted-foreground font-medium">
            {isBoardMode
              ? "Keine Aushänge gefunden"
              : isServiceMode
                ? "Keine Dienstleistungen gefunden"
                : "Keine Artikel gefunden"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {searchQuery || categoryFilter || conditionFilter
              ? "Versuchen Sie andere Suchbegriffe oder Filter."
              : isBoardMode
                ? "Es gibt derzeit keine aktiven Aushänge."
                : isServiceMode
                  ? "Es gibt derzeit keine aktiven Dienstleistungen."
                  : "Es gibt derzeit keine aktiven Inserate."}
          </p>
        </div>
      )}
    </div>
  )
}
