import type { Metadata } from "next";
import { monaSans, monaSansMono } from "./fonts";
import "./globals.css";
import { ThirdwebProvider } from "thirdweb/react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "sonner";
import { ConditionalFooter } from "@/components/layout/ConditionalFooter";
import { GlobalWalletRedirect } from "@/components/app/GlobalWalletRedirect";
import { GlobalAutoConnect } from "@/components/app/GlobalAutoConnect";
import { GlobalAppDownloadSheet } from "@/components/app/GlobalAppDownloadSheet";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AccountProvider } from "@/lib/context/AccountContext";
import { Analytics } from "@vercel/analytics/react";
import { RecordModeNotice } from "@/components/RecordModeNotice";

export const metadata: Metadata = {
  title: "Röbel App",
  description:
    "Veranstaltungen, Neuigkeiten und Kinoprogramm aus Röbel",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-96x96.png", sizes: "96x96", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${monaSans.variable} ${monaSansMono.variable}`} suppressHydrationWarning>
      <body className={`${monaSans.className} flex flex-col min-h-screen overflow-x-hidden`}>
        <ThemeProvider>
          <ThirdwebProvider>
            <GlobalAutoConnect />
            <AccountProvider>
              <GlobalWalletRedirect />
              <RecordModeNotice />
              <div className="flex-1">{children}</div>
              <ConditionalFooter />
              <GlobalAppDownloadSheet />
              <Toaster />
              <Sonner position="top-right" richColors />
              <Analytics />
            </AccountProvider>
          </ThirdwebProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
