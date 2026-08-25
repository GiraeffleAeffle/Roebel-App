"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { ProfilePictureUpload } from "./ProfilePictureUpload";
import { InterestTagsInput } from "./InterestTagsInput";
import { VereineInput } from "./VereineInput";
import { supabase } from "@/lib/supabase";
import {
  validateUsername,
  validateBio,
  NEIGHBORHOODS,
  getRoleInfo,
} from "@/lib/user-types";
import { checkUsernameAvailable } from "@/lib/supabase-users";
import type { User, UpdateUserProfileInput } from "@/lib/user-types";
import type { UserTier } from "@/types/account";

interface ProfileFormProps {
  user: User;
  onSave: (updates: Omit<UpdateUserProfileInput, "wallet_address">) => Promise<void>;
  isSaving: boolean;
  /** Staging guests are display-only and must not write profiles or Storage. */
  canPersist: boolean;
}

/** New tier values shown in the form */
const TIERS: UserTier[] = ["citizen", "tourist", "guest"];

export function ProfileForm({ user, onSave, isSaving, canPersist }: ProfileFormProps) {
  const [username, setUsername] = useState(user.username || "");
  const [bio, setBio] = useState(user.bio || "");
  const [profilePictureUrl, setProfilePictureUrl] = useState(
    user.profile_picture_url || ""
  );
  const [coverImageUrl, setCoverImageUrl] = useState(
    user.cover_image_url || ""
  );
  const [tier, setTier] = useState<UserTier>(user.tier || "guest");
  const [neighborhood, setNeighborhood] = useState(user.neighborhood || "");
  const [interests, setInterests] = useState<string[]>(user.interests || []);
  const [vereine, setVereine] = useState<string[]>(user.vereine || []);

  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [bioError, setBioError] = useState<string | null>(null);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const isTourist = tier === "tourist" || tier === "guest";

  // Check if form has changes
  useEffect(() => {
    const changed =
      username !== (user.username || "") ||
      bio !== (user.bio || "") ||
      profilePictureUrl !== (user.profile_picture_url || "") ||
      coverImageUrl !== (user.cover_image_url || "") ||
      tier !== (user.tier || "guest") ||
      neighborhood !== (user.neighborhood || "") ||
      JSON.stringify(interests) !== JSON.stringify(user.interests || []) ||
      JSON.stringify(vereine) !== JSON.stringify(user.vereine || []);

    setHasChanges(changed);
  }, [username, bio, profilePictureUrl, coverImageUrl, tier, neighborhood, interests, vereine, user]);

  // Validate username as user types
  useEffect(() => {
    if (!username) {
      setUsernameError(null);
      return;
    }

    const validation = validateUsername(username);
    if (!validation.valid) {
      setUsernameError(validation.error || null);
      return;
    }

    // Check availability (debounced)
    const timeoutId = setTimeout(async () => {
      if (username === user.username) {
        setUsernameError(null);
        return;
      }

      setIsCheckingUsername(true);
      const result = await checkUsernameAvailable(
        username,
        user.wallet_address
      );
      setIsCheckingUsername(false);

      if (!result.available) {
        setUsernameError("Benutzername ist bereits vergeben");
      } else {
        setUsernameError(null);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [username, user.username, user.wallet_address]);

  // Validate bio
  useEffect(() => {
    const validation = validateBio(bio);
    setBioError(validation.valid ? null : validation.error || null);
  }, [bio]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canPersist || usernameError || bioError || !hasChanges) return;

    const updates: Omit<UpdateUserProfileInput, "wallet_address"> = {};

    if (username !== (user.username || "")) {
      updates.username = username || undefined;
    }
    if (bio !== (user.bio || "")) {
      updates.bio = bio || undefined;
    }
    if (profilePictureUrl !== (user.profile_picture_url || "")) {
      updates.profile_picture_url = profilePictureUrl || undefined;
    }
    if (coverImageUrl !== (user.cover_image_url || "")) {
      updates.cover_image_url = coverImageUrl || null;
    }
    if (tier !== (user.tier || "guest")) {
      // Send via the `role` field — supabase-users.ts maps it to the DB `tier` column
      updates.role = tier as any;
    }
    if (neighborhood !== (user.neighborhood || "")) {
      updates.neighborhood = neighborhood || null;
    }
    if (JSON.stringify(interests) !== JSON.stringify(user.interests || [])) {
      updates.interests = interests;
    }
    if (JSON.stringify(vereine) !== JSON.stringify(user.vereine || [])) {
      updates.vereine = vereine;
    }

    await onSave(updates);
  };

  const handleReset = () => {
    setUsername(user.username || "");
    setBio(user.bio || "");
    setProfilePictureUrl(user.profile_picture_url || "");
    setCoverImageUrl(user.cover_image_url || "");
    setTier(user.tier || "guest");
    setNeighborhood(user.neighborhood || "");
    setInterests(user.interests || []);
    setVereine(user.vereine || []);
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-6">
      <h3 className="text-xl font-medium text-foreground mb-6">Profil bearbeiten</h3>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Cover Image */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-3">
            Titelbild
          </label>
          <div className="relative rounded-lg overflow-hidden bg-muted h-32">
            {coverImageUrl ? (
              <Image
                src={coverImageUrl}
                alt="Cover"
                fill
                className="object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
            )}
            {isUploadingCover && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                if (!canPersist) return;
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) return;
                setIsUploadingCover(true);
                try {
                  const fileExt = file.name.split(".").pop();
                  const fileName = `cover-${user.wallet_address.toLowerCase()}-${Date.now()}.${fileExt}`;
                  const { error: uploadError } = await supabase.storage
                    .from("profile-pictures")
                    .upload(fileName, file, { cacheControl: "3600", upsert: true });
                  if (uploadError) throw uploadError;
                  const { data: { publicUrl } } = supabase.storage
                    .from("profile-pictures")
                    .getPublicUrl(fileName);
                  setCoverImageUrl(publicUrl);
                } catch (err) {
                  console.error("Cover upload error:", err);
                } finally {
                  setIsUploadingCover(false);
                }
              }}
            />
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              disabled={!canPersist || isUploadingCover}
              className="text-sm text-primary hover:text-primary/80 font-medium"
            >
              {coverImageUrl ? "Titelbild ändern" : "Titelbild hochladen"}
            </button>
            {coverImageUrl && (
              <button
                type="button"
                onClick={() => setCoverImageUrl("")}
                className="text-sm text-red-500 hover:text-red-600 font-medium"
              >
                Entfernen
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">JPG, PNG oder GIF. Max 5MB.</p>
        </div>

        {/* Profile Picture */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-3">
            Profilbild
          </label>
          <ProfilePictureUpload
            currentPictureUrl={profilePictureUrl}
            walletAddress={user.wallet_address}
            onUploadComplete={setProfilePictureUrl}
            canPersist={canPersist}
          />
        </div>

        {/* Username */}
        <div>
          <label
            htmlFor="username"
            className="block text-sm font-medium text-foreground mb-2"
          >
            Benutzername <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Benutzernamen eingeben"
            className={`w-full bg-card border ${
              usernameError ? "border-red-500" : "border-border"
            } rounded-lg px-4 py-3 text-foreground focus:outline-none focus:border-ring transition-colors`}
          />
          {isCheckingUsername && (
            <p className="text-xs text-muted-foreground mt-1">
              Verfügbarkeit wird geprüft...
            </p>
          )}
          {usernameError && (
            <p className="text-xs text-red-600 mt-1">{usernameError}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            3-30 Zeichen. Buchstaben, Zahlen und Unterstriche.
          </p>
        </div>

        {/* Bio */}
        <div>
          <label
            htmlFor="bio"
            className="block text-sm font-medium text-foreground mb-2"
          >
            Bio <span className="text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Erzählen Sie etwas über sich..."
            rows={4}
            maxLength={500}
            className={`w-full bg-card border ${
              bioError ? "border-red-500" : "border-border"
            } rounded-lg px-4 py-3 text-foreground focus:outline-none focus:border-ring transition-colors resize-none`}
          />
          {bioError && (
            <p className="text-xs text-red-600 mt-1">{bioError}</p>
          )}
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>Max 500 Zeichen</span>
            <span>{bio.length}/500</span>
          </div>
        </div>

        {/* Tier */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Status
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {TIERS.map((t) => {
              const info = getRoleInfo(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTier(t)}
                  className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    tier === t
                      ? `${info.bgColor} ${info.textColor} ${info.borderColor}`
                      : "bg-card border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {info.labelDe}
                </button>
              );
            })}
          </div>
        </div>

        {/* Neighborhood - hidden for tourist */}
        {!isTourist && (
          <div>
            <label
              htmlFor="neighborhood"
              className="block text-sm font-medium text-foreground mb-2"
            >
              Stadtteil <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="neighborhood"
              type="text"
              list="neighborhoods"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              placeholder="Stadtteil auswählen oder eingeben"
              className="w-full bg-card border border-border rounded-lg px-4 py-3 text-foreground focus:outline-none focus:border-ring transition-colors"
            />
            <datalist id="neighborhoods">
              {NEIGHBORHOODS.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
        )}

        {/* Interests - hidden for tourist */}
        {!isTourist && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Interessen <span className="text-muted-foreground">(optional)</span>
            </label>
            <InterestTagsInput selected={interests} onChange={setInterests} />
          </div>
        )}

        {/* Vereine - hidden for tourist */}
        {!isTourist && (
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Vereine <span className="text-muted-foreground">(optional)</span>
            </label>
            <VereineInput vereine={vereine} onChange={setVereine} />
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isSaving || !hasChanges || !!usernameError || !!bioError}
            className={`flex-1 font-medium py-3 px-6 rounded-lg transition-colors ${
              isSaving || !hasChanges || usernameError || bioError
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-black hover:bg-foreground/90 text-white"
            }`}
          >
            {isSaving ? "Speichern..." : "Änderungen speichern"}
          </button>

          {hasChanges && (
            <button
              type="button"
              onClick={handleReset}
              disabled={isSaving}
              className="px-6 py-3 bg-muted hover:bg-muted text-foreground rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              Abbrechen
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
