"use client";

export const dynamic = "force-dynamic";

import { Header } from "@/components/layout/Header";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useVerificationStatus } from "@/hooks/useVerificationStatus";
import { useActiveAccount } from "thirdweb/react";
import { formatWalletAddress } from "@/lib/user-types";
import type { UpdateUserProfileInput, PrivacySettings } from "@/lib/user-types";
import { DEFAULT_PRIVACY_SETTINGS } from "@/lib/user-types";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { RoleBadge } from "@/components/profile/RoleBadge";
import { PrivacySettingsForm } from "@/components/profile/PrivacySettingsForm";
import QRCode from "qrcode";
import { useRequests } from "@/hooks/useRequests";

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
  const { isAttester, isCitizen, votingPower } = useVerificationStatus();

  // Fetch user's verification requests
  const { requests: attesterRequests, isLoading: loadingAttester } = useRequests("attester");
  const { requests: citizenRequests, isLoading: loadingCitizen } = useRequests("citizen");

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

  const handleShowQR = async (requestId?: number, contractType?: 'citizen' | 'attester') => {
    if (!account?.address) return;

    // Generate verification URL
    let verificationUrl: string;

    if (requestId !== undefined && contractType) {
      // Link to specific request details page
      verificationUrl = `${window.location.origin}/verifizierung/nachweis/${requestId}?contract=${contractType}`;
    } else {
      // Fallback: Link to verification page
      verificationUrl = `${window.location.origin}/verifizierung`;
    }

    try {
      const qr = await QRCode.toDataURL(verificationUrl, {
        width: 300,
        margin: 2,
      });
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
      <div className="min-h-screen bg-muted">
        <Header />
        <main className="container mx-auto px-3 sm:px-4 py-6 sm:py-12">
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
                href="/"
                className="inline-block bg-foreground hover:bg-foreground text-white px-4 sm:px-5 py-2 rounded-md font-medium transition-colors text-sm"
              >
                Zur Startseite
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <div className="animate-pulse space-y-4">
              <div className="h-6 bg-muted rounded w-1/4" />
              <div className="h-32 bg-muted rounded-lg" />
              <div className="h-24 bg-muted rounded-lg" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="min-h-screen bg-muted">
        <Header />
        <main className="container mx-auto px-4 py-12">
          <div className="max-w-2xl mx-auto text-center">
            <div className="bg-card border border-border rounded-lg p-8">
              <h2 className="text-xl font-medium mb-3 text-foreground">Fehler beim Laden</h2>
              <p className="text-muted-foreground mb-6 text-sm">{error || "Profil konnte nicht geladen werden"}</p>
              <Link
                href="/"
                className="inline-block bg-black hover:bg-foreground/90 text-white px-5 py-2 rounded-md font-medium transition-colors text-sm"
              >
                Zur Startseite
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const nftBalance = Number(user.nft_balance);
  const hasCitizen = nftBalance > 0;

  return (
    <div className="min-h-screen bg-muted">
      <Header />

      <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-8">
        <div className="max-w-2xl mx-auto">
          {/* Page Header */}
          <div className="mb-4 sm:mb-6">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl sm:text-2xl font-medium text-foreground">Profil</h1>
              <RoleBadge role={user.role || "resident"} />
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground break-all">
              {formatWalletAddress(user.wallet_address)}
            </p>
          </div>

          {/* Profile Info */}
          {(user.neighborhood || (user.interests && user.interests.length > 0) || (user.vereine && user.vereine.length > 0)) && (
            <div className="bg-card border border-border rounded-lg p-3 sm:p-4 mb-3 sm:mb-4">
              {user.neighborhood && (
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-sm text-foreground">{user.neighborhood}</span>
                </div>
              )}

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

          {/* Status Messages */}
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

          {/* Citizenship Status - MOST IMPORTANT */}
          <div className="bg-card border border-border rounded-lg p-3 sm:p-4 mb-3 sm:mb-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-base font-medium text-foreground">Bürger-Pass</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {hasCitizen ? "Aktiv" : "Nicht vorhanden"}
                </p>
              </div>
              <div className="flex items-center justify-center w-8 h-8">
                {hasCitizen ? (
                  <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
            </div>

            {hasCitizen ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Stimmrecht</span>
                  <span className="text-foreground">
                    {votingPower && votingPower > 0n ? "Aktiviert" : "Nicht aktiviert"}
                  </span>
                </div>

                <button
                  onClick={() => handleShowQR()}
                  className="w-full bg-muted hover:bg-accent text-foreground py-2 rounded-md text-sm font-medium transition-colors"
                >
                  QR-Code anzeigen
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-muted border border-border rounded-md p-3">
                  <p className="text-xs text-muted-foreground">
                    Sie haben noch keinen Bürger-Pass. Beantragen Sie einen Pass, um an Abstimmungen teilnehmen zu können.
                  </p>
                </div>
                <Link
                  href="/verifizierung/buerger"
                  className="flex items-center justify-center gap-2 w-full bg-foreground hover:bg-foreground text-white py-2 rounded-md text-sm font-medium transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Bürger-Pass beantragen
                </Link>
              </div>
            )}
          </div>

          {/* Attester Status */}
          {isAttester && (
            <div className="bg-card border border-border rounded-lg p-3 sm:p-4 mb-3 sm:mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm sm:text-base font-medium text-foreground">Bescheiniger-Status</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Berechtigt Anträge zu bestätigen</p>
                </div>
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          )}

          {/* Civic Participation (resident / official) */}
          {(user.role === "resident" || user.role === "official") && (
            <div className="bg-card border border-border rounded-lg p-3 sm:p-4 mb-3 sm:mb-4">
              <h2 className="text-sm sm:text-base font-medium text-foreground mb-3">Bürger-Aktivität</h2>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <p className="text-lg sm:text-xl font-semibold text-foreground">{Number(user.total_votes_cast || 0)}</p>
                  <p className="text-xs text-muted-foreground">Abstimmungen</p>
                </div>
                <div className="text-center">
                  <p className="text-lg sm:text-xl font-semibold text-foreground">{Number(user.voting_streak || 0)}</p>
                  <p className="text-xs text-muted-foreground">Streak</p>
                </div>
                <div className="text-center">
                  <p className="text-lg sm:text-xl font-semibold text-foreground">{Number(user.gamification_points || 0)}</p>
                  <p className="text-xs text-muted-foreground">Punkte</p>
                </div>
              </div>
            </div>
          )}

          {/* Business Profile Placeholder */}
          {user.role === "business" && (
            <div className="bg-card border border-border rounded-lg p-3 sm:p-4 mb-3 sm:mb-4">
              <h2 className="text-sm sm:text-base font-medium text-foreground mb-2">Gewerbe-Profil</h2>
              <p className="text-xs text-muted-foreground">
                Dienste und Bewertungen werden bald verfügbar sein.
              </p>
            </div>
          )}

          {/* My Verification Requests */}
          {account && (
            <div className="bg-card border border-border rounded-lg p-3 sm:p-4 mb-3 sm:mb-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm sm:text-base font-medium text-foreground">Meine Verifizierungs-Anträge</h2>
                <Link
                  href="/verifizierung/antraege"
                  className="text-xs text-primary hover:text-primary/80 transition-colors whitespace-nowrap"
                >
                  Alle anzeigen →
                </Link>
              </div>

              {(loadingAttester || loadingCitizen) ? (
                <div className="flex items-center justify-center py-6 sm:py-8">
                  <div className="animate-spin rounded-full h-6 w-6 sm:h-8 sm:w-8 border-b-2 border-black"></div>
                </div>
              ) : (() => {
                // Filter requests where user is the requester
                const myAttesterRequests = attesterRequests.filter(
                  (req) => req.requester.toLowerCase() === account.address.toLowerCase()
                );
                const myCitizenRequests = citizenRequests.filter(
                  (req) => req.requester.toLowerCase() === account.address.toLowerCase()
                );
                const totalMyRequests = myAttesterRequests.length + myCitizenRequests.length;

                if (totalMyRequests === 0) {
                  return (
                    <div className="text-center py-6">
                      <p className="text-sm text-muted-foreground mb-3">
                        Du hast noch keine Verifizierungs-Anträge erstellt
                      </p>
                      <Link
                        href="/verifizierung"
                        className="inline-block bg-black hover:bg-foreground/90 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                      >
                        Jetzt beantragen
                      </Link>
                    </div>
                  );
                }

                return (
                  <div className="space-y-2">
                    {/* Citizen Requests */}
                    {myCitizenRequests.map((request) => (
                      <div
                        key={`citizen-${request.id}`}
                        className="p-3 bg-muted border border-border rounded-lg"
                      >
                        <Link
                          href={`/verifizierung/nachweis/${request.id}?contract=citizen`}
                          className="block hover:bg-accent -m-3 p-3 rounded-lg transition-all"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100">
                                <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                              </div>
                              <div>
                                <p className="text-sm font-medium text-foreground">
                                  Bürger-Pass #{request.id}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {request.status === 0 && "Ausstehend"}
                                  {request.status === 1 && "Genehmigt"}
                                  {request.status === 2 && "Abgelehnt"}
                                  {request.status === 3 && "Ausgeführt"}
                                  {" • "}
                                  {"attesterSignatures" in request && "citizenSignatures" in request && (
                                    <>
                                      {request.attesterSignatures}/1 Bescheiniger, {request.citizenSignatures}/1 Bürger
                                    </>
                                  )}
                                </p>
                              </div>
                            </div>
                            <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </Link>

                        {/* QR Code Button for Pending Requests */}
                        {request.status === 0 && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              handleShowQR(Number(request.id), 'citizen');
                            }}
                            className="mt-2 w-full bg-card hover:bg-accent border border-border text-foreground py-2 px-3 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                            </svg>
                            QR-Code für Unterschriften
                          </button>
                        )}
                      </div>
                    ))}

                    {/* Attester Requests */}
                    {myAttesterRequests.map((request) => (
                      <Link
                        key={`attester-${request.id}`}
                        href={`/verifizierung/nachweis/${request.id}?contract=attester`}
                        className="block p-3 bg-muted hover:bg-accent border border-border hover:border-black rounded-lg transition-all"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-purple-100">
                              <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                              </svg>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                Bescheiniger-Pass #{request.id}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {request.status === 0 && "Ausstehend"}
                                {request.status === 1 && "Genehmigt"}
                                {request.status === 2 && "Abgelehnt"}
                                {request.status === 3 && "Ausgeführt"}
                                {" • "}
                                {"signatureCount" in request && (
                                  <>{request.signatureCount}/3 Unterschriften</>
                                )}
                              </p>
                            </div>
                          </div>
                          <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </Link>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {canPersistProfile && (
            <>
              {/* Profile Edit Button */}
              <button
                onClick={() => setShowEditModal(true)}
                className="w-full bg-card border border-border hover:bg-accent text-foreground py-2 rounded-md text-xs sm:text-sm font-medium transition-colors mb-3 sm:mb-4 active:scale-95"
              >
                Profil bearbeiten
              </button>

              {/* Privacy Settings Button */}
              <button
                onClick={() => setShowPrivacyModal(true)}
                className="w-full bg-card border border-border hover:bg-accent text-foreground py-2 rounded-md text-xs sm:text-sm font-medium transition-colors mb-3 sm:mb-4 active:scale-95"
              >
                Datenschutz-Einstellungen
              </button>
            </>
          )}

          {/* Quick Actions */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Link
              href="/verifizierung"
              className="bg-card border border-border hover:bg-accent rounded-md p-2.5 sm:p-3 text-center transition-colors active:scale-95"
            >
              <p className="text-xs sm:text-sm font-medium text-foreground">Verifizierung</p>
            </Link>
            <Link
              href="/proposals"
              className="bg-card border border-border hover:bg-accent rounded-md p-2.5 sm:p-3 text-center transition-colors active:scale-95"
            >
              <p className="text-xs sm:text-sm font-medium text-foreground">Abstimmungen</p>
            </Link>
            <Link
              href="/nachrichten"
              className="bg-card border border-border hover:bg-accent rounded-md p-2.5 sm:p-3 text-center transition-colors active:scale-95"
            >
              <p className="text-xs sm:text-sm font-medium text-foreground">Nachrichten</p>
            </Link>
          </div>
        </div>
      </main>

      {/* Edit Profile Modal */}
      {canPersistProfile && showEditModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-4 z-50">
          <div className="bg-card rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-3 sm:p-4 border-b border-border flex items-center justify-between sticky top-0 bg-card">
              <h2 className="text-base sm:text-lg font-medium text-foreground">Profil bearbeiten</h2>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-muted-foreground hover:text-foreground p-1 active:scale-95"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-3 sm:p-4">
              <ProfileForm
                user={user}
                onSave={handleSaveProfile}
                isSaving={isSaving}
                canPersist={canPersistProfile}
              />
            </div>
          </div>
        </div>
      )}

      {/* Privacy Settings Modal */}
      {canPersistProfile && showPrivacyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-4 z-50">
          <div className="bg-card rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-3 sm:p-4 border-b border-border flex items-center justify-between sticky top-0 bg-card">
              <h2 className="text-base sm:text-lg font-medium text-foreground">Datenschutz-Einstellungen</h2>
              <button
                onClick={() => setShowPrivacyModal(false)}
                className="text-muted-foreground hover:text-foreground p-1 active:scale-95"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-3 sm:p-4">
              <PrivacySettingsForm
                settings={privacySettings}
                onChange={handleSavePrivacy}
              />
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {showQRModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-4 z-50">
          <div className="bg-card rounded-lg max-w-sm w-full p-4 sm:p-6">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h2 className="text-base sm:text-lg font-medium text-foreground">Verifizierungs-QR</h2>
              <button
                onClick={() => setShowQRModal(false)}
                className="text-muted-foreground hover:text-foreground p-1 active:scale-95"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex justify-center mb-3 sm:mb-4">
              {qrCodeUrl && <img src={qrCodeUrl} alt="QR Code" className="w-48 h-48 sm:w-64 sm:h-64" />}
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground text-center">
              Zeigen Sie diesen QR-Code einem Bescheiniger zur Verifizierung
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
