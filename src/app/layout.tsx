import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: {
    default: "x",
    template: "%s / x",
  },
  description: "A Twitter/X-style social app.",
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
