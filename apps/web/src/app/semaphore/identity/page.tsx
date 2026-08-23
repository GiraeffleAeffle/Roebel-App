"use client";

import { useState, useEffect } from "react";
import {
  generateIdentity,
  saveIdentity,
  loadIdentity,
  hasIdentity,
  getCommitment,
  exportIdentity,
  importIdentity,
  deleteIdentity,
  formatIdentityInfo,
} from "@/lib/semaphore/identity";
import type { Identity } from "@semaphore-protocol/identity";

// Force dynamic rendering since we use localStorage
export const dynamic = 'force-dynamic';

export default function IdentityPage() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [password, setPassword] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [exportData, setExportData] = useState("");
  const [importData, setImportData] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState<"check" | "generate" | "view">("check");

  useEffect(() => {
    // Check if user already has an identity
    if (hasIdentity()) {
      const loaded = loadIdentity();
      if (loaded) {
        setIdentity(loaded);
        setStep("view");
      }
    }
  }, []);

  const handleGenerate = () => {
    const newIdentity = generateIdentity();
    setIdentity(newIdentity);
    setStep("view");

    // Auto-save without password (user can set password later)
    saveIdentity(newIdentity);
  };

  const handleSaveWithPassword = () => {
    if (!identity || !password) return;

    try {
      saveIdentity(identity, password);
      alert("Identity saved with password protection!");
      setPassword("");
    } catch (error) {
      alert("Failed to save identity: " + error);
    }
  };

  const handleExport = () => {
    if (!identity || !password) {
      alert("Please enter a password for encryption");
      return;
    }

    const encrypted = exportIdentity(identity, password);
    setExportData(encrypted);
  };

  const handleImport = () => {
    if (!importData || !importPassword) {
      alert("Please provide encrypted data and password");
      return;
    }

    try {
      const imported = importIdentity(importData, importPassword);
      setIdentity(imported);
      saveIdentity(imported, importPassword);
      setStep("view");
      setImportData("");
      setImportPassword("");
      alert("Identity imported successfully!");
    } catch (error) {
      alert("Failed to import: " + error);
    }
  };

  const handleDelete = () => {
    if (
      confirm(
        "⚠️ WARNING: This will permanently delete your identity. You will lose access to your citizen account. Are you absolutely sure?"
      )
    ) {
      if (
        confirm(
          "Last chance! This action cannot be undone. Have you backed up your identity?"
        )
      ) {
        deleteIdentity();
        setIdentity(null);
        setStep("check");
        alert("Identity deleted");
      }
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (step === "check" || !identity) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-card rounded-2xl shadow-xl p-8">
            <h1 className="text-4xl font-medium mb-4 text-foreground">
              Citizen Identity
            </h1>
            <p className="text-lg text-muted-foreground mb-8">
              Generate your anonymous citizen identity for hometown governance
            </p>

            <div className="bg-blue-50 border-l-4 border-blue-500 p-6 mb-8">
              <h2 className="text-xl font-medium text-blue-900 mb-2">
                What is a Semaphore Identity?
              </h2>
              <ul className="list-disc list-inside text-blue-800 space-y-2">
                <li>
                  A cryptographic identity that proves you&apos;re a verified citizen
                </li>
                <li>
                  Allows you to vote and create proposals <strong>anonymously</strong>
                </li>
                <li>
                  Your identity secret <strong>never leaves your device</strong>
                </li>
                <li>Only your &quot;commitment&quot; is shared with administrators</li>
              </ul>
            </div>

            {!hasIdentity() ? (
              <div>
                <button
                  onClick={handleGenerate}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-4 px-6 rounded-lg text-lg transition-colors"
                >
                  Generate New Identity
                </button>

                <div className="mt-8 pt-8 border-t border-border">
                  <h3 className="text-lg font-medium mb-4">
                    Already have an identity?
                  </h3>
                  <div className="space-y-4">
                    <textarea
                      placeholder="Paste encrypted identity backup"
                      value={importData}
                      onChange={(e) => setImportData(e.target.value)}
                      className="w-full px-4 py-2 border border-border rounded-lg h-24"
                    />
                    <input
                      type="password"
                      placeholder="Backup password"
                      value={importPassword}
                      onChange={(e) => setImportPassword(e.target.value)}
                      className="w-full px-4 py-2 border border-border rounded-lg"
                    />
                    <button
                      onClick={handleImport}
                      className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
                    >
                      Import Identity
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  const loaded = loadIdentity();
                  if (loaded) {
                    setIdentity(loaded);
                    setStep("view");
                  }
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-4 px-6 rounded-lg text-lg transition-colors"
              >
                View Existing Identity
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const info = formatIdentityInfo(identity);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Identity Commitment */}
        <div className="bg-card rounded-2xl shadow-xl p-8">
          <h2 className="text-2xl font-medium mb-4 text-foreground">
            Your Identity Commitment
          </h2>
          <p className="text-muted-foreground mb-4">
            Share this with the administrator to register as a citizen:
          </p>

          <div className="bg-muted p-4 rounded-lg mb-4 break-all font-mono text-sm">
            {getCommitment(identity)}
          </div>

          <button
            onClick={() => copyToClipboard(getCommitment(identity))}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
          >
            {copied ? "✓ Copied!" : "Copy Commitment"}
          </button>
        </div>

        {/* Security Warning */}
        <div className="bg-yellow-50 border-l-4 border-yellow-500 p-6">
          <h3 className="text-lg font-medium text-yellow-900 mb-2">
            ⚠️ Security Notice
          </h3>
          <ul className="list-disc list-inside text-yellow-800 space-y-1">
            <li>Back up your identity immediately (use Export feature below)</li>
            <li>
              Never share your identity secret with anyone, including admins
            </li>
            <li>Store your backup in a secure location</li>
            <li>Loss of identity = loss of citizen access</li>
          </ul>
        </div>

        {/* Export/Backup */}
        <div className="bg-card rounded-2xl shadow-xl p-8">
          <h2 className="text-2xl font-medium mb-4 text-foreground">
            Backup Identity
          </h2>
          <p className="text-muted-foreground mb-4">
            Export your identity with password encryption:
          </p>

          <div className="space-y-4">
            <input
              type="password"
              placeholder="Enter encryption password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border border-border rounded-lg"
            />

            <button
              onClick={handleExport}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
            >
              Export Encrypted Backup
            </button>

            {exportData && (
              <div>
                <p className="text-sm text-muted-foreground mb-2">
                  Save this encrypted backup in a secure location:
                </p>
                <textarea
                  value={exportData}
                  readOnly
                  className="w-full px-4 py-2 border border-border rounded-lg h-32 font-mono text-xs"
                />
                <button
                  onClick={() => copyToClipboard(exportData)}
                  className="mt-2 w-full bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                >
                  Copy Backup
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Advanced Settings */}
        <div className="bg-card rounded-2xl shadow-xl p-8">
          <h2 className="text-2xl font-medium mb-4 text-foreground">
            Advanced Settings
          </h2>

          <div className="space-y-4">
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={showSecret}
                  onChange={(e) => setShowSecret(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-foreground">
                  Show identity details (for debugging only)
                </span>
              </label>
            </div>

            {showSecret && (
              <div className="bg-red-50 border border-red-200 p-4 rounded-lg">
                <p className="text-red-600 font-medium mb-2">
                  ⚠️ Sensitive Information - Do NOT share!
                </p>
                <div className="space-y-2 text-xs font-mono break-all">
                  <div>
                    <strong>Commitment (Public):</strong> {info.commitment}
                  </div>
                  <div>
                    <strong>Private Key (SECRET):</strong> {info.privateKey}
                  </div>
                  <div className="text-muted-foreground text-xs mt-2">
                    Note: Semaphore v4 uses EdDSA key pairs. The private key is your secret.
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={handleDelete}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
            >
              🗑️ Delete Identity
            </button>
          </div>
        </div>

        {/* Next Steps */}
        <div className="bg-card rounded-2xl shadow-xl p-8">
          <h2 className="text-2xl font-medium mb-4 text-foreground">Next Steps</h2>
          <ol className="list-decimal list-inside space-y-3 text-foreground">
            <li>
              <strong>Copy your commitment</strong> (above)
            </li>
            <li>
              <strong>Send it to the town administrator</strong> for verification
            </li>
            <li>
              <strong>Wait for approval</strong> (admin will verify your
              citizenship off-chain)
            </li>
            <li>
              <strong>Once approved</strong>, you can create proposals and vote
              anonymously!
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
