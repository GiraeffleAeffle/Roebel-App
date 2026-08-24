"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Upload, X, Image as ImageIcon } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { toast } from "sonner"
import Image from "next/image"

interface ImageUploadDropzoneProps {
  onUploadComplete: (url: string) => void
  currentImageUrl?: string
  bucketName?: string
  folder?: string
  maxSizeMB?: number
  /** Staging guests may view an image but must never upload or remove one. */
  canUpload?: boolean
}

export function ImageUploadDropzone({
  onUploadComplete,
  currentImageUrl = "",
  bucketName = "news-images",
  folder = "",
  maxSizeMB = 5,
  canUpload = true,
}: ImageUploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string>(currentImageUrl)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync previewUrl when currentImageUrl changes from parent
  useEffect(() => {
    setPreviewUrl(currentImageUrl)
  }, [currentImageUrl])

  const uploadFile = useCallback(async (file: File) => {
    if (!canUpload) {
      toast.error("Staging-Gastprofile können keine Bilder hochladen")
      return
    }

    // Validate file inline
    if (!file.type.startsWith("image/")) {
      toast.error("Bitte wählen Sie eine Bilddatei aus")
      return
    }

    const maxSize = maxSizeMB * 1024 * 1024
    if (file.size > maxSize) {
      toast.error(`Bild muss kleiner als ${maxSizeMB}MB sein`)
      return
    }

    setIsUploading(true)
    const loadingToast = toast.loading("Bild wird hochgeladen...")

    try {
      const supabase = createClient()

      // Create preview
      const reader = new FileReader()
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string)
      }
      reader.readAsDataURL(file)

      // Generate unique filename
      const fileExt = file.name.split(".").pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
      const cleanFolder = folder.replace(/^\/+|\/+$/g, "")
      const filePath = cleanFolder ? `${cleanFolder}/${fileName}` : fileName

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
        })

      if (uploadError) {
        throw uploadError
      }

      // Get public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from(bucketName).getPublicUrl(filePath)

      toast.success("Bild erfolgreich hochgeladen", { id: loadingToast })
      onUploadComplete(publicUrl)
      setPreviewUrl(publicUrl)
    } catch (error) {
      console.error("Upload error:", error)
      toast.error("Fehler beim Hochladen", {
        id: loadingToast,
        description: error instanceof Error ? error.message : "Unbekannter Fehler",
      })
      setPreviewUrl(currentImageUrl)
    } finally {
      setIsUploading(false)
    }
  }, [bucketName, canUpload, folder, currentImageUrl, maxSizeMB, onUploadComplete])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)

    const file = e.dataTransfer.files[0]
    if (file) {
      uploadFile(file)
    }
  }, [uploadFile])

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      uploadFile(file)
    }
  }

  const handleRemove = () => {
    if (!canUpload) return
    setPreviewUrl("")
    onUploadComplete("")
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
    toast.success("Bild entfernt")
  }

  const handleClick = () => {
    if (!canUpload) return
    fileInputRef.current?.click()
  }

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
        disabled={!canUpload || isUploading}
      />

      {previewUrl ? (
        <div className="relative group h-64">
          <Image
            src={previewUrl}
            alt="Preview"
            fill
            className="object-cover rounded-[10px] border-2 border-border"
          />
          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all rounded-[10px] flex items-center justify-center">
            <button
              type="button"
              onClick={handleRemove}
              disabled={!canUpload || isUploading}
              className="opacity-0 group-hover:opacity-100 transition-opacity bg-card text-foreground rounded-full p-3 hover:bg-accent"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {isUploading && (
            <div className="absolute inset-0 bg-black bg-opacity-50 rounded-[10px] flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={handleClick}
          className={`border-2 border-dashed rounded-[10px] p-12 text-center cursor-pointer transition-all ${
            isDragging
              ? "border-primary bg-primary/10"
              : "border-border hover:border-gray-400 hover:bg-accent"
          } ${!canUpload || isUploading ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <div className="flex flex-col items-center gap-4">
            {isUploading ? (
              <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <Upload className="h-8 w-8 text-muted-foreground" />
              </div>
            )}
            <div>
              <p className="text-lg font-medium text-foreground mb-1">
                {isUploading
                  ? "Wird hochgeladen..."
                  : canUpload
                    ? "Bild hochladen"
                    : "Upload im Gastprofil deaktiviert"}
              </p>
              {canUpload && (
                <p className="text-sm text-muted-foreground">
                  Ziehen Sie ein Bild hierher oder klicken Sie zum Auswählen
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-2">
                PNG, JPG, GIF bis zu {maxSizeMB}MB
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
