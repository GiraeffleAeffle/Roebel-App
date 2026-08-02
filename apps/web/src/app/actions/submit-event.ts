"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { geocodeLocation } from "@/lib/utils/geocoding"
import { hasSupabase } from "@/lib/record"

export async function submitEvent(formData: FormData) {
  // Belt-and-braces: the UI already hides this form when keyless, but a
  // direct POST must get the honest German answer, not the generic English
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

    // Handle image upload first
    let imageUrl = null
    const imageFile = formData.get("image_file") as File
    
    if (imageFile && imageFile.size > 0) {
      // Create a unique filename
      const fileExt = imageFile.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`
      const filePath = `event-images/${fileName}`

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('images')
        .upload(filePath, imageFile, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) {
        console.error("Image upload error:", uploadError)
        return { success: false, error: "Failed to upload image. Please try again." }
      }

      // Get the public URL
      const { data: urlData } = supabase.storage
        .from('images')
        .getPublicUrl(filePath)
      
      imageUrl = urlData.publicUrl
    }

    // Get location from form
    const locationText = formData.get("location") as string

    // Try to geocode the location server-side
    let latitude: number | null = null
    let longitude: number | null = null
    let placeId: string | null = null
    let formattedAddress: string | null = locationText
    let addressComponents: any[] | null = null

    if (locationText) {
      const placeData = await geocodeLocation(locationText)
      if (placeData) {
        latitude = placeData.latitude
        longitude = placeData.longitude
        placeId = placeData.place_id
        formattedAddress = placeData.formatted_address
        addressComponents = placeData.address_components
      }
    }

    // Extract recurring event data
    const isRecurring = formData.get("is_recurring") === "true"
    const datesStr = formData.get("dates") as string
    let dates: string[] = []
    if (datesStr) {
      try {
        dates = JSON.parse(datesStr)
      } catch (e) {
        console.error("Failed to parse dates:", e)
      }
    }

    // Determine primary date
    const primaryDate = dates.length > 0 ? dates[0] : (formData.get("date") as string)

    // Extract account_id if provided
    const accountId = (formData.get("account_id") as string) || null

    // Extract form data
    const eventData = {
      title: formData.get("title") as string,
      description: (formData.get("description") as string) || null,
      date: primaryDate,
      time: (formData.get("time") as string) || null,
      end_time: (formData.get("end_time") as string) || null,
      location: locationText,
      organizer_name: formData.get("organizer_name") as string,
      organizer_email: formData.get("organizer_email") as string,
      organizer_phone: (formData.get("organizer_phone") as string) || null,
      category: (formData.get("category") as string) || null,
      image_url: imageUrl,
      website_url: (formData.get("website_url") as string) || null,
      ticket_price: formData.get("ticket_price") ? Number.parseFloat(formData.get("ticket_price") as string) : 0,
      max_attendees: formData.get("max_attendees") ? Number.parseInt(formData.get("max_attendees") as string) : null,
      status: "pending",
      is_recurring: isRecurring,
      account_id: accountId,
      // Geographical data from server-side geocoding
      latitude,
      longitude,
      place_id: placeId,
      formatted_address: formattedAddress,
      address_components: addressComponents,
    }

    // Validate required fields
    if (
      !eventData.title ||
      !eventData.date ||
      !eventData.location ||
      !eventData.organizer_name ||
      !eventData.organizer_email
    ) {
      return { success: false, error: "Please fill in all required fields." }
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(eventData.organizer_email)) {
      return { success: false, error: "Please enter a valid email address." }
    }

    // Validate date is not in the past
    const eventDate = new Date(eventData.date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    if (eventDate < today) {
      return { success: false, error: "Event date cannot be in the past." }
    }

    // Validate coordinates if provided
    if (latitude !== null && longitude !== null) {
      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return { success: false, error: "Invalid geographical coordinates." }
      }
    }

    // Insert event into database
    const { data, error } = await supabase.from("events").insert([eventData]).select().single()

    if (error) {
      console.error("Database error:", error)
      return { success: false, error: "Failed to submit event. Please try again." }
    }

    // Insert dates into event_dates table
    const datesToInsert = dates.length > 0 ? dates : [primaryDate]
    const eventDates = datesToInsert.map(date => ({
      event_id: data.id,
      date: date,
    }))

    const { error: datesError } = await supabase.from("event_dates").insert(eventDates)

    if (datesError) {
      console.error("Error inserting event dates:", datesError)
      // Don't fail the whole submission, event was created successfully
    }

    // Revalidate the home page to show updated events (when approved)
    revalidatePath("/")

    return { success: true, data }
  } catch (error) {
    console.error("Server error:", error)
    return { success: false, error: "An unexpected error occurred. Please try again." }
  }
}
