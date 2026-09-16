import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";
import { PublicChrome } from "@/components/public-chrome";

const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

export const viewport: Viewport = {
  colorScheme: "light",
};

export const metadata: Metadata = {
  title: {
    default: "UniNexus Connect Gala Awards",
    template: "%s | UniNexus Connect Gala Awards",
  },
  description: "Recognizing and honouring the leaders, founders, creative talents, entrepreneurs, innovators, and changemakers shaping the future of Kenya's campuses, colleges & education institutions.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://unx-awards.vercel.app"),
  openGraph: {
    title: "UniNexus Connect Gala Awards",
    description: "Nominate, and vote for, the people shaping the future of Kenya's campuses.",
    images: ["/logos/gala-logo.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:z-[100] focus:bg-gold focus:text-ink focus:px-4 focus:py-2 focus:rounded-md">
          Skip to content
        </a>
        <PublicChrome slot="top" />
        <main id="main">{children}</main>
        <PublicChrome slot="bottom" />
      </body>
    </html>
  );
}
