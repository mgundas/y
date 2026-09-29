import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { env } from "@/lib/env";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

// Absolute URLs for unfurls. Prefers the client-safe origin, falls back to the
// auth origin - both are validated URLs at boot, so neither can be garbage.
const siteUrl = env.NEXT_PUBLIC_APP_URL ?? env.BETTER_AUTH_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "y",
    template: "%s / y",
  },
  description: "A Y-style social app.",
  openGraph: {
    siteName: "y",
    type: "website",
  },
  twitter: {
    card: "summary",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Dark by default. The toggle that persists a user preference arrives in
    // Phase 8; until then this is the whole theming story.
    <html lang="en" className={cn("dark font-sans", geist.variable)}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <TooltipProvider>
          {children}
          <Toaster position="bottom-center" />
        </TooltipProvider>
      </body>
    </html>
  );
}
