"use client";

export const dynamic = "force-dynamic";

import { useUserProfile } from "@/hooks/useUserProfile";
import { useVerificationStatus } from "@/hooks/useVerificationStatus";
import { useActiveAccount } from "thirdweb/react";
import { formatWalletAddress, getDaysSinceJoined } from "@/lib/user-types";
import type { UpdateUserProfileInput, PrivacySettings } from "@/lib/user-types";
import { DEFAULT_PRIVACY_SETTINGS } from "@/lib/user-types";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { RoleBadge } from "@/components/profile/RoleBadge";
import { PrivacySettingsForm } from "@/components/profile/PrivacySettingsForm";
import { ProfileHero } from "@/components/profile/ProfileHero";
import { ProfileActionGrid, type ProfileAction } from "@/components/profile/ProfileActionGrid";
import { ProfileMenuList, type ProfileMenuItem } from "@/components/profile/ProfileMenuList";
import { useAccount } from "@/lib/context/AccountContext";
import {
  isOrgAccount,
  subTypeFeatures,
  SUB_TYPE_LABELS,
  SUB_TYPE_EMOJI,
} from "@/types/account";
import {
  CreditCard,
  Vote,
  ShieldCheck,
  CalendarPlus,
  Tag,
  MessageCircle,
  Pencil,
  QrCode,
  FileText,
  Shield,
  Building2,
  Calendar,
  Package,
  Megaphone,
  Users,
  UtensilsCrossed,
  Clock,
  Handshake,
  BookOpen,
  Settings,
  HelpCircle,
} from "lucide-react";
import QRCode from "qrcode";

export default function ProfilePage() {
  const {
    user,
    isLoading,
    error,
    refreshUser,
    updateProfile,
    isConnected,
    canPersistProfile,
    walletAddress,
  } = useUserProfile();
  const account = useActiveAccount();
  const { isAttester, isCitizen, votingPower, isVerified } = useVerificationStatus();
  const { activeAccount, ownedAccounts } = useAccount();
  const isOrg = activeAccount ? isOrgAccount(activeAccount) : false;

  const [showEditModal, setShowEditModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>(
    user?.privacy_settings || DEFAULT_PRIVACY_SETTINGS
  );
  const privacyWalletRef = useRef<string | null>(null);
  const currentWalletRef = useRef<string | null>(walletAddress?.toLowerCase() || null);
  currentWalletRef.current = walletAddress?.toLowerCase() || null;
  const hasLoadedUser = user !== null;
  const profileWallet = user?.wallet_address?.toLowerCase() || null;
  const loadedPrivacySettings = user?.privacy_settings;

  // Privacy controls belong to the loaded persisted wallet, never to the
  // component instance. Reset on disconnect/guest mode and rehydrate on a
  // new persisted wallet before accepting a submission.
  useEffect(() => {
    if (!hasLoadedUser || !canPersistProfile || !profileWallet) {
      privacyWalletRef.current = null;
      setPrivacySettings(DEFAULT_PRIVACY_SETTINGS);
      setShowPrivacyModal(false);
      return;
    }

    if (privacyWalletRef.current === profileWallet) return;
    privacyWalletRef.current = profileWallet;
    setPrivacySettings({
      ...DEFAULT_PRIVACY_SETTINGS,
      ...(loadedPrivacySettings || {}),
    });
    setShowPrivacyModal(false);
  }, [canPersistProfile, hasLoadedUser, loadedPrivacySettings, profileWallet]);

  const handleSaveProfile = async (updates: Omit<UpdateUserProfileInput, "wallet_address">) => {
    if (!user || !canPersistProfile) {
      setSaveError("Staging-Gastprofile können nicht geändert werden");
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const result = await updateProfile(updates);

      if (result.success) {
        setSaveSuccess(true);
        await refreshUser();
        setTimeout(() => {
          setSaveSuccess(false);
          setShowEditModal(false);
        }, 2000);
      } else {
        setSaveError(result.error || "Fehler beim Speichern");
      }
    } catch (err) {
      console.error("❌ Error saving profile:", err);
      setSaveError(err instanceof Error ? err.message : "Fehler beim Speichern");
    } finally {
      setIsSaving(false);
    }
  };

  const handleShowQR = async () => {
    if (!account?.address) return;
    const verificationUrl = `${window.location.origin}/verifizierung`;
    try {
      const qr = await QRCode.toDataURL(verificationUrl, { width: 300, margin: 2 });
      setQrCodeUrl(qr);
      setShowQRModal(true);
    } catch (err) {
      console.error("Error generating QR code:", err);
    }
  };

  const handleSavePrivacy = async (settings: PrivacySettings) => {
    const submissionWallet = user?.wallet_address?.toLowerCase() || null;
    if (
      !user ||
      !canPersistProfile ||
      !submissionWallet ||
      privacyWalletRef.current !== submissionWallet ||
      currentWalletRef.current !== submissionWallet
    ) {
      setSaveError("Staging-Gastprofile können nicht geändert werden");
      return;
    }

    const result = await updateProfile({ privacy_settings: settings });
    if (
      result.success &&
      currentWalletRef.current === submissionWallet &&
      privacyWalletRef.current === submissionWallet
    ) {
      setPrivacySettings(settings);
      await refreshUser();
    } else if (!result.success) {
      setSaveError(result.error || "Fehler beim Speichern");
    }
  };

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <div className="bg-card border border-border rounded-lg p-6 sm:p-8">
          <div className="flex justify-center mb-4">
            <svg className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-lg sm:text-xl font-medium mb-3 text-foreground">Anmeldung erforderlich</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Bitte melden Sie sich an, um Ihr Profil anzuzeigen.
          </p>
          <Link
            href="/app"
            className="inline-block bg-foreground hover:bg-foreground/90 text-white px-4 sm:px-5 py-2 rounded-md font-medium transition-colors text-sm"
          >
            Zur Startseite
          </Link>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/4" />
          <div className="h-32 bg-muted rounded-lg" />
          <div className="h-24 bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <div className="bg-card border border-border rounded-lg p-8">
          <h2 className="text-xl font-medium mb-3 text-foreground">Fehler beim Laden</h2>
          <p className="text-muted-foreground mb-6 text-sm">{error || "Profil konnte nicht geladen werden"}</p>
          <Link
            href="/app"
            className="inline-block bg-foreground hover:bg-foreground/80 text-white px-5 py-2 rounded-md font-medium transition-colors text-sm"
          >
            Zur Startseite
          </Link>
        </div>
      </div>
    );
  }

  const nftBalance = Number(user.nft_balance);
  const hasCitizen = nftBalance > 0;
  const daysSinceJoined = getDaysSinceJoined(user.created_at);
  const hasOrg = ownedAccounts.some((a) => isOrgAccount(a));

  // ── Org view ────────────────────────────────────────────────────────
  if (isOrg && activeAccount) {
    const features = subTypeFeatures(activeAccount.sub_type);
    const subLabel = activeAccount.sub_type
      ? `${SUB_TYPE_EMOJI[activeAccount.sub_type]} ${SUB_TYPE_LABELS[activeAccount.sub_type]}`
      : "Organisation";

    const orgActions: ProfileAction[] = [
      features.blog && { label: "Blog", icon: FileText, href: "/dashboard/blog" },
      features.events && { label: "Events", icon: Calendar, href: "/dashboard/events" },
      features.speisekarte && { label: "Speisekarte", icon: UtensilsCrossed, href: "/dashboard/speisekarte" },
      features.products && { label: "Produkte", icon: Package, href: "/dashboard/products" },
      features.ads && { label: "Anzeigen", icon: Megaphone, href: "/dashboard/ads" },
      features.members && { label: "Mitglieder", icon: Users, href: "/dashboard/members" },
      features.openingHours && { label: "Öffnungszeiten", icon: Clock, href: "/dashboard/opening-hours" },
      features.partner && { label: "Partner", icon: Handshake, href: "/dashboard/partner" },
      features.storyCollections && { label: "Stories", icon: BookOpen, href: "/dashboard/story-collections" },
    ].filter(Boolean) as ProfileAction[];

    const orgMenu: ProfileMenuItem[][] = [
      [
        ...(canPersistProfile
          ? [{ label: "Profil bearbeiten", icon: Pencil, href: "/dashboard/profile" }]
          : []),
        { label: "Einstellungen", icon: Settings, href: "/dashboard/settings" },
      ],
      ...(canPersistProfile
        ? [[{ label: "Datenschutz", icon: Shield, onClick: () => setShowPrivacyModal(true) }]]
        : []),
    ];

    return (
      <>
        <div className="max-w-2xl mx-auto">
          <ProfileHero
            name={activeAccount.name}
            coverUrl={activeAccount.cover_url}
            avatarUrl={activeAccount.avatar_url}
            avatarShape="rounded"
            verified={activeAccount.is_verified}
            bio={activeAccount.bio}
            pill={
              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-primary/10 text-primary border border-primary/20">
                {subLabel}
              </span>
            }
            meta={
              !activeAccount.is_verified ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-600 text-[11px] font-medium">
                  In Prüfung
                </span>
              ) : undefined
            }
            action={
              canPersistProfile
                ? { label: "Profil bearbeiten", href: "/dashboard/profile" }
                : undefined
            }
          />

          <ProfileActionGrid actions={orgActions} />
          <ProfileMenuList groups={orgMenu} />
        </div>

        {canPersistProfile && showPrivacyModal && (
          <PrivacyModal
            settings={privacySettings}
            onChange={handleSavePrivacy}
            onClose={() => setShowPrivacyModal(false)}
          />
        )}
      </>
    );
  }

  // ── Personal view ───────────────────────────────────────────────────
  const isResidentOrOfficial = user.role === "resident" || user.role === "official";

  const personalActions: ProfileAction[] = [
    { label: "Röbel Card", icon: CreditCard, href: "/app/roebel-card" },
    { label: "Abstimmungen", icon: Vote, href: "/app/proposals" },
    { label: "Verifizierung", icon: ShieldCheck, href: "/app/verifizierung" },
    { label: "Veranstaltung", icon: CalendarPlus, href: "/app/submit" },
    { label: "Anzeige", icon: Tag, href: "/app/marktplatz" },
    { label: "Nachrichten", icon: MessageCircle, href: "/app/messages" },
  ];

  const personalMenu: ProfileMenuItem[][] = [
    [
      ...(canPersistProfile
        ? [{ label: "Profil bearbeiten", icon: Pencil, onClick: () => setShowEditModal(true) }]
        : []),
      hasCitizen
        ? { label: "QR-Code anzeigen", icon: QrCode, onClick: handleShowQR }
        : { label: "Bürger-Pass beantragen", icon: QrCode, href: "/verifizierung/buerger-beantragen" },
      { label: "Meine Anträge", icon: FileText, href: "/verifizierung/antraege" },
      ...(!hasOrg
        ? [{ label: "Organisation erstellen", icon: Building2, href: "/app/org/create" }]
        : []),
    ],
    [
      ...(canPersistProfile
        ? [{ label: "Datenschutz", icon: Shield, onClick: () => setShowPrivacyModal(true) }]
        : []),
      { label: "Hilfe & Support", icon: HelpCircle, href: "/app/support" },
    ],
  ];

  return (
    <>
      <div className="max-w-2xl mx-auto">
        <ProfileHero
          name={user.username || formatWalletAddress(user.wallet_address)}
          coverUrl={user.cover_image_url}
          avatarUrl={user.profile_picture_url}
          avatarShape="circle"
          verified={hasCitizen}
          bio={user.bio}
          pill={<RoleBadge role={user.role || "resident"} />}
          meta={
            <>
              {user.username && <span>{formatWalletAddress(user.wallet_address)}</span>}
              {user.neighborhood && <span>{user.neighborhood}</span>}
              <span>Seit {daysSinceJoined} Tagen Mitglied</span>
            </>
          }
          action={
            canPersistProfile
              ? { label: "Bearbeiten", onClick: () => setShowEditModal(true) }
              : undefined
          }
        />

        {/* Civic stats — folds in the old "Bürger-Aktivität" card */}
        {isResidentOrOfficial && (
          <div className="bg-card border border-border rounded-lg p-3 sm:p-4 mb-3 sm:mb-4">
            <div className="grid grid-cols-4 gap-2">
              <Stat value={votingPower} label="Stimmrecht" />
              <Stat value={Number(user.total_votes_cast || 0)} label="Abstimmungen" />
              <Stat value={Number(user.voting_streak || 0)} label="Streak" />
              <Stat value={Number(user.gamification_points || 0)} label="Punkte" />
            </div>
            {isAttester && (
              <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="w-4 h-4 text-green-600" />
                Bescheiniger — berechtigt, Anträge zu bestätigen
              </div>
            )}
          </div>
        )}

        <ProfileActionGrid actions={personalActions} />

        {/* Interests & Vereine */}
        {((user.interests && user.interests.length > 0) ||
          (user.vereine && user.vereine.length > 0)) && (
          <div className="bg-card border border-border rounded-lg p-3 sm:p-4 mb-3 sm:mb-4">
            {user.interests && user.interests.length > 0 && (
              <div className="mb-2">
                <p className="text-xs text-muted-foreground mb-1.5">Interessen</p>
                <div className="flex flex-wrap gap-1.5">
                  {user.interests.map((interest: string) => (
                    <span key={interest} className="px-2 py-0.5 bg-muted text-muted-foreground rounded-full text-xs">
                      {interest}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {user.vereine && user.vereine.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Vereine</p>
                <div className="flex flex-wrap gap-1.5">
                  {user.vereine.map((verein: string) => (
                    <span key={verein} className="px-2 py-0.5 bg-muted text-muted-foreground rounded-full text-xs">
                      {verein}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <ProfileMenuList groups={personalMenu} />

        {saveSuccess && (
          <div className="mb-3 sm:mb-4 bg-card border border-border rounded-lg p-2.5 sm:p-3">
            <p className="text-xs sm:text-sm text-foreground">Profil aktualisiert</p>
          </div>
        )}
        {saveError && (
          <div className="mb-3 sm:mb-4 bg-card border border-border rounded-lg p-2.5 sm:p-3">
            <p className="text-xs sm:text-sm text-foreground">{saveError}</p>
          </div>
        )}
      </div>

      {/* Edit Profile Modal */}
      {canPersistProfile && showEditModal && (
        <Modal title="Profil bearbeiten" onClose={() => setShowEditModal(false)}>
          <ProfileForm
            user={user}
            onSave={handleSaveProfile}
            isSaving={isSaving}
            canPersist={canPersistProfile}
          />
        </Modal>
      )}

      {/* Privacy Settings Modal */}
      {canPersistProfile && showPrivacyModal && (
        <PrivacyModal
          settings={privacySettings}
          onChange={handleSavePrivacy}
          onClose={() => setShowPrivacyModal(false)}
        />
      )}

      {/* QR Code Modal */}
      {showQRModal && (
        <Modal title="Verifizierungs-QR" onClose={() => setShowQRModal(false)}>
          <div className="flex justify-center mb-3 sm:mb-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qrCodeUrl && <img src={qrCodeUrl} alt="QR Code" className="w-48 h-48 sm:w-64 sm:h-64" />}
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground text-center">
            Zeigen Sie diesen QR-Code einem Bescheiniger zur Verifizierung
          </p>
        </Modal>
      )}
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <p className="text-lg sm:text-xl font-semibold text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-4 z-50">
      <div className="bg-card rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-3 sm:p-4 border-b border-border flex items-center justify-between sticky top-0 bg-card">
          <h2 className="text-base sm:text-lg font-medium text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 active:scale-95"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-3 sm:p-4">{children}</div>
      </div>
    </div>
  );
}

function PrivacyModal({
  settings,
  onChange,
  onClose,
}: {
  settings: PrivacySettings;
  onChange: (s: PrivacySettings) => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Datenschutz-Einstellungen" onClose={onClose}>
      <PrivacySettingsForm settings={settings} onChange={onChange} />
    </Modal>
  );
}
