"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import {
  STAGING_PROFILE_MUTATION_ERROR,
  runProfileWrite,
} from "@/lib/stadtstack/profile-write-boundary.mjs";

interface ProfilePictureUploadProps {
  currentPictureUrl: string | null;
  walletAddress: string;
  onUploadComplete: (url: string) => void;
  canPersist: boolean;
}

export function ProfilePictureUpload({
  currentPictureUrl,
  walletAddress,
  onUploadComplete,
  canPersist,
}: ProfilePictureUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentPictureUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!canPersist) return;
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file");
      return;
    }

    // Max 2MB
    if (file.size > 2 * 1024 * 1024) {
      setError("Image must be less than 2MB");
      return;
    }

    setError(null);
    setIsUploading(true);

    try {
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string);
      };
      reader.readAsDataURL(file);

      // Generate unique filename
      const fileExt = file.name.split(".").pop();
      const fileName = `${walletAddress.toLowerCase()}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      console.log("📤 Uploading profile picture:", filePath);

      const result = await runProfileWrite(
        canPersist
          ? { allowed: true }
          : { allowed: false, error: STAGING_PROFILE_MUTATION_ERROR },
        async () => {
          // Upload to Supabase Storage only inside the canonical capability.
          const { error: uploadError } = await supabase.storage
            .from("profile-pictures")
            .upload(filePath, file, {
              cacheControl: "3600",
              upsert: true,
            });

          if (uploadError) {
            return { success: false, error: uploadError.message };
          }

          // Get public URL
          const {
            data: { publicUrl },
          } = supabase.storage.from("profile-pictures").getPublicUrl(filePath);

          return { success: true, data: { publicUrl } };
        },
      );

      if (!result.success || !result.data) {
        setError(result.error || "Upload failed");
        return;
      }

      const { publicUrl } = result.data;

      console.log("✅ Upload complete:", publicUrl);

      // Call callback
      onUploadComplete(publicUrl);
    } catch (err) {
      console.error("❌ Error uploading image:", err);
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = () => {
    if (!canPersist) return;
    setPreviewUrl(null);
    onUploadComplete("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        {/* Profile Picture Preview */}
        <div className="relative w-24 h-24">
          {previewUrl ? (
            <Image
              src={previewUrl}
              alt="Profile"
              fill
              className="rounded-full object-cover border-2 border-gray-700"
              sizes="96px"
            />
          ) : (
            <div className="w-24 h-24 rounded-full bg-gray-800 border-2 border-gray-700 flex items-center justify-center">
              <svg
                className="w-12 h-12 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
            </div>
          )}

          {isUploading && (
            <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Upload Controls */}
        <div className="flex-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            disabled={!canPersist || isUploading}
            className="hidden"
            id="profile-picture-upload"
          />

          <label
            htmlFor="profile-picture-upload"
            className={`inline-block px-4 py-2 rounded-lg font-medium transition-colors cursor-pointer ${
              !canPersist || isUploading
                ? "bg-gray-700 text-muted-foreground cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
          >
            {!canPersist
              ? "Staging-Gastprofil"
              : isUploading
                ? "Uploading..."
                : previewUrl
                  ? "Change Picture"
                  : "Upload Picture"}
          </label>

          {canPersist && previewUrl && !isUploading && (
            <button
              onClick={handleRemove}
              className="ml-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
            >
              Remove
            </button>
          )}

          <p className="text-xs text-muted-foreground mt-2">
            JPG, PNG or GIF. Max 2MB.
          </p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-900 border border-red-700 rounded-lg p-3">
          <p className="text-sm text-red-200">{error}</p>
        </div>
      )}
    </div>
  );
}
