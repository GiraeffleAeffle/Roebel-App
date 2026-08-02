"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import type { Feedback, FeedbackStatus, FeedbackType } from "@/types/feedback"
import { hasSupabase } from "@/lib/record"

export async function submitFeedback(formData: FormData) {
  // Belt-and-braces: the UI already hides this form when keyless, but a
  // direct POST must get the honest German answer, not the generic
  // catch-all below (which would misleadingly invite a retry).
  if (!hasSupabase) {
    return {
      success: false,
      error:
        "Diese Funktion benötigt ein Backend und ist im öffentlichen Datensatz nicht verfügbar.",
    }
  }

  try {
    const supabase = await createClient()

    // Extract form data
    const feedbackData = {
      user_wallet_address: (formData.get("user_wallet_address") as string) || null,
      feedback_type: formData.get("feedback_type") as FeedbackType,
      subject: formData.get("subject") as string,
      message: formData.get("message") as string,
      contact_email: (formData.get("contact_email") as string) || null,
      contact_phone: (formData.get("contact_phone") as string) || null,
      device_info: formData.get("device_info") ? JSON.parse(formData.get("device_info") as string) : {},
      status: "new" as FeedbackStatus,
      source: "web_form" as const,
    }

    // Validate required fields
    if (!feedbackData.feedback_type || !feedbackData.subject || !feedbackData.message) {
      return { success: false, error: "Bitte füllen Sie alle Pflichtfelder aus." }
    }

    // Validate email format if provided
    if (feedbackData.contact_email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(feedbackData.contact_email)) {
        return { success: false, error: "Bitte geben Sie eine gültige E-Mail-Adresse ein." }
      }
    }

    // Insert feedback into database
    const { data, error } = await supabase.from("feedback").insert([feedbackData]).select()

    if (error) {
      console.error("Database error:", error)
      return { success: false, error: "Fehler beim Absenden des Feedbacks. Bitte versuchen Sie es erneut." }
    }

    // Revalidate the admin dashboard feedback page
    revalidatePath("/admin/dashboard/feedback")

    return { success: true, data }
  } catch (error) {
    console.error("Server error:", error)
    return { success: false, error: "Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut." }
  }
}

export async function getFeedback() {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("feedback")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) throw error

    return { success: true, data: data as Feedback[] }
  } catch (error) {
    console.error("Error fetching feedback:", error)
    return { success: false, error: "Fehler beim Laden des Feedbacks" }
  }
}

export async function updateFeedbackStatus(id: string, status: FeedbackStatus) {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("feedback")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single()

    if (error) throw error

    revalidatePath("/dashboard/feedback")

    return { success: true, data: data as Feedback, message: "Status erfolgreich aktualisiert" }
  } catch (error) {
    console.error("Error updating feedback status:", error)
    return { success: false, error: "Fehler beim Aktualisieren des Status" }
  }
}

export async function deleteFeedback(id: string) {
  try {
    const supabase = await createClient()

    const { error } = await supabase.from("feedback").delete().eq("id", id)

    if (error) throw error

    revalidatePath("/dashboard/feedback")

    return { success: true, message: "Feedback erfolgreich gelöscht" }
  } catch (error) {
    console.error("Error deleting feedback:", error)
    return { success: false, error: "Fehler beim Löschen des Feedbacks" }
  }
}

export async function getFeedbackStats() {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase.from("feedback").select("status")

    if (error) throw error

    const stats = {
      total: data.length,
      new: data.filter((f) => f.status === "new").length,
      in_review: data.filter((f) => f.status === "in_review").length,
      resolved: data.filter((f) => f.status === "resolved").length,
      closed: data.filter((f) => f.status === "closed").length,
    }

    return { success: true, data: stats }
  } catch (error) {
    console.error("Error fetching feedback stats:", error)
    return { success: false, error: "Fehler beim Laden der Statistiken" }
  }
}
