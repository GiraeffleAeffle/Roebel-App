import { supabase } from "@/lib/supabase"
import { hasSupabase } from "@/lib/record"

export interface DocumentationChapter {
  id: string
  title: string
  slug: string
  pdf_url: string
  storage_path: string
  display_order: number
  created_at: string
  updated_at: string
}

// Uploaded PDF documentation chapters are a Supabase-storage-only feature
// with no record equivalent — the reader page already renders a friendly
// "wird gerade vorbereitet" empty state for zero chapters, so record mode
// simply reuses it rather than crashing on the keyless Proxy.

/** All chapters in display order (public + admin reads). */
export async function getChapters(): Promise<DocumentationChapter[]> {
  if (!hasSupabase) return []

  const { data, error } = await supabase
    .from("documentation_chapters")
    .select("*")
    .order("display_order", { ascending: true })

  if (error) {
    console.error("Error fetching documentation chapters:", error)
    return []
  }

  return data || []
}

/** Single chapter by slug for the public reader. Returns null if not found. */
export async function getChapterBySlug(
  slug: string
): Promise<DocumentationChapter | null> {
  if (!hasSupabase) return null

  const { data, error } = await supabase
    .from("documentation_chapters")
    .select("*")
    .eq("slug", slug)
    .maybeSingle()

  if (error) {
    console.error("Error fetching documentation chapter:", error)
    return null
  }

  return data
}
