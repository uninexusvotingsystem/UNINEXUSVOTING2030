import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";

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
    default: "UNX Awards",
    template: "%s | UNX Awards",
  },
  description: "Nominate, and vote for, the people who make campuses across Kenya extraordinary.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://unx-awards.vercel.app"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:z-[100] focus:bg-gold focus:text-ink focus:px-4 focus:py-2 focus:rounded-md">
          Skip to content
        </a>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
