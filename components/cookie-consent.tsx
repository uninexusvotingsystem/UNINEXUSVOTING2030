"use client";

import { useEffect, useState } from "react";
import { Cookie, X } from "lucide-react";

const STORAGE_KEY = "unx_cookie_consent";

export function CookieConsent() {
  // Starts hidden and only appears after the check below confirms no prior
  // choice — otherwise it would flash on screen for a moment on every single
  // page load for people who already dismissed it.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // Storage blocked (private mode / strict browser settings) — just don't
      // show the banner rather than erroring on a public page.
    }
  }, []);

  function accept() {
    try {
      localStorage.setItem(STORAGE_KEY, "accepted");
    } catch {
      // Ignore — dismissing for this session is still better than nothing.
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-4">
      <div className="container max-w-3xl">
        <div className="bg-ink text-cream rounded-xl2 shadow-2xl border border-gold/20 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <Cookie className="size-5 text-gold shrink-0" />
          <p className="text-sm text-cream/75 flex-1">
            We use essential cookies to keep this site secure and working properly — including remembering your
            verification so your vote counts correctly. We don&apos;t use advertising or tracking cookies.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={accept} className="btn-gold !py-2 !px-5 text-sm">
              Got it
            </button>
            <button onClick={accept} aria-label="Dismiss" className="p-2 text-cream/40 hover:text-cream/70">
              <X className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
