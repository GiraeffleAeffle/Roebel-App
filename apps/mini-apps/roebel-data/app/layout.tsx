import type { Metadata, Viewport } from "next";
import { monaSans, monaSansMono } from "./fonts";
import { manifest } from "@roebel-data/manifest";
import { isMarienfelderPublicDemo } from "../src/lib/publicDemoMode";
import "./globals.css";

const publicDemoOnly = isMarienfelderPublicDemo(
  process.env.NEXT_PUBLIC_STADTSTACK_PUBLIC_DEMO_MODE,
);

export const metadata: Metadata = {
  title: manifest.name,
  description: manifest.description,
  robots: publicDemoOnly
    ? { index: false, follow: false, nocache: true }
    : undefined,
};

// Mini apps render in a phone-sized modal. Lock the viewport to the device
// width and let the host manage safe-area insets (read via sdk.getContext()).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: manifest.primaryColor ?? "#00498B",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="de"
      className={`${monaSans.variable} ${monaSansMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
