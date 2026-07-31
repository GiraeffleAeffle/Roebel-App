"use client";

import { ConnectButton, useActiveAccount } from "thirdweb/react";
import { inAppWallet } from "thirdweb/wallets";
import { client } from "@/app/client";
import { activeChain } from "@/lib/chains";

const wallets = [
  inAppWallet({
    auth: {
      options: ["email", "phone", "google", "apple", "facebook"],
    },
    smartAccount: {
      chain: activeChain,
      sponsorGas: true,
    },
  }),
];

export default function RevealKeyPage() {
  const account = useActiveAccount();

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-950 dark:to-gray-900 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <header className="mb-8">
          <h1 className="text-3xl font-medium tracking-tight text-gray-900 dark:text-white">
            Wallet-Schlüssel
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            Exportieren Sie Ihren Privatschlüssel über die offizielle Thirdweb-Oberfläche.
          </p>
        </header>

        <section className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
          <h2 className="mb-1 text-sm font-medium text-red-800 dark:text-red-300">
            Wichtiger Hinweis
          </h2>
          <p className="text-sm leading-relaxed text-red-700 dark:text-red-200/90">
            Geben Sie Ihren Privatschlüssel niemals weiter. Wer ihn besitzt, kontrolliert Ihr
            Wallet vollständig. Es gibt keine Recovery-Phrase – nur den hexadezimalen Schlüssel.
          </p>
        </section>

        <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <ol className="space-y-3 text-sm text-gray-700 dark:text-gray-200">
            <li>
              <span className="font-medium">1.</span> Melden Sie sich mit{" "}
              <span className="font-medium">derselben Anmeldemethode</span> wie in der Röbel-App an
              (z. B. dieselbe E-Mail, Google-, Apple- oder Facebook-Konto).
            </li>
            <li>
              <span className="font-medium">2.</span> Klicken Sie nach dem Anmelden auf Ihre
              Wallet-Adresse oben rechts.
            </li>
            <li>
              <span className="font-medium">3.</span> Wählen Sie{" "}
              <span className="font-medium">&bdquo;Manage Wallet&ldquo; &rarr; &bdquo;Export Private Key&ldquo;</span> und
              bestätigen Sie den Export.
            </li>
          </ol>
        </section>

        <div className="mb-6 flex justify-center">
          <ConnectButton
            client={client}
            chain={activeChain}
            wallets={wallets}
            autoConnect={false}
            theme="light"
            connectButton={{
              label: "Mit Röbel-Konto anmelden",
              style: {
                backgroundColor: "#00498B",
                color: "#ffffff",
                minWidth: 240,
              },
            }}
            connectModal={{
              title: "Mit Röbel-Konto anmelden",
              size: "compact",
            }}
            detailsModal={{
              hideSwitchWallet: true,
            }}
          />
        </div>

        {account && (
          <section className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-800 dark:bg-gray-900/60">
            <p className="text-gray-500 dark:text-gray-400">Verbundene Adresse</p>
            <p className="mt-1 break-all font-mono text-gray-900 dark:text-gray-100">
              {account.address}
            </p>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Hinweis: Dies ist die Smart-Wallet-Adresse. Der exportierte Schlüssel gehört dem
              dahinterliegenden EOA-Signer. Importieren Sie ihn z. B. in MetaMask, um Ihr Wallet
              wiederherzustellen.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
