import Link from "next/link";
import { Facebook, Instagram, Mail, ExternalLink } from "lucide-react";
import { SOCIALS, SLOGAN, MAIN_SITE_URL } from "@/lib/constants";

function TikTokIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M16.6 5.82a4.28 4.28 0 0 1-2.71-1.07 4.36 4.36 0 0 1-1.45-2.62h-3v13.66a2.6 2.6 0 1 1-1.83-2.48V9.44a5.9 5.9 0 1 0 4.83 5.8V9.03a7.24 7.24 0 0 0 4.16 1.31V7.09a4.24 4.24 0 0 1-.99-.04Z" />
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="surface-ink pt-14 pb-8">
      <div className="container">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6 pb-10 border-b border-white/10">
          <div>
            <p className="font-display text-xl text-cream mb-1">UNX Awards</p>
            <p className="text-sm text-cream/50">Nominate. Vote. Celebrate.</p>
          </div>

          <div className="flex items-center gap-3">
            <a href={SOCIALS.facebook} target="_blank" rel="noreferrer" aria-label="Facebook"
              className="size-9 rounded-full border border-gold/30 flex items-center justify-center text-gold hover:bg-gold hover:text-ink transition-colors">
              <Facebook className="size-4" />
            </a>
            <a href={SOCIALS.instagram} target="_blank" rel="noreferrer" aria-label="Instagram"
              className="size-9 rounded-full border border-gold/30 flex items-center justify-center text-gold hover:bg-gold hover:text-ink transition-colors">
              <Instagram className="size-4" />
            </a>
            <a href={SOCIALS.tiktok} target="_blank" rel="noreferrer" aria-label="TikTok"
              className="size-9 rounded-full border border-gold/30 flex items-center justify-center text-gold hover:bg-gold hover:text-ink transition-colors">
              <TikTokIcon className="size-4" />
            </a>
            <a href={`mailto:${SOCIALS.email}`} aria-label="Email"
              className="size-9 rounded-full border border-gold/30 flex items-center justify-center text-gold hover:bg-gold hover:text-ink transition-colors">
              <Mail className="size-4" />
            </a>
          </div>
        </div>

        <div className="py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-sm text-cream/50 max-w-md">
            This is UNX Awards, a standalone nominations &amp; voting platform run alongside UniNexus Connect.
          </p>
          <a href={MAIN_SITE_URL} target="_blank" rel="noreferrer"
            className="btn-outline-gold !py-2.5 !px-5 text-sm inline-flex items-center gap-2 shrink-0">
            Visit UniNexus Connect <ExternalLink className="size-3.5" />
          </a>
        </div>

        <div className="pt-6 border-t border-white/5 text-center">
          {/*
            This slogan line is also the admin's way into the panel — a UNX
            Awards admin knows to click it; a regular visitor just sees a
            slogan line, since nothing about it looks or reads like a link
            (no underline, no distinct hover state, no "admin" text anywhere).
          */}
          <Link href="/admin/login" className="text-xs tracking-[0.15em] text-gold/40 hover:text-gold/60 transition-colors">
            {SLOGAN.toUpperCase()}
          </Link>
        </div>
      </div>
    </footer>
  );
}
