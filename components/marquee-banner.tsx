import { createClient } from "@/lib/supabase/server";

const DEFAULT_MESSAGE =
  "UniNexus Connect Nomination Now Open & Ends on Friday 25th September. Nominate One. Nominate All!";

async function getMarqueeText() {
  try {
    const supabase = createClient();
    const { data } = await supabase.from("site_settings").select("value").eq("key", "marquee_text").maybeSingle();
    return data?.value || DEFAULT_MESSAGE;
  } catch {
    // Never let a settings-table hiccup take down every public page — fall
    // back to the default message rather than throwing.
    return DEFAULT_MESSAGE;
  }
}

export async function MarqueeBanner() {
  const text = await getMarqueeText();
  // Duplicated because the CSS animation translates the track by -50%: the
  // second copy is what slides in behind the first, making the scroll loop
  // seamless instead of visibly snapping back to the start.
  const items = Array.from({ length: 6 }, () => text);

  return (
    <div className="bg-gold/95 text-ink overflow-hidden py-2 border-b border-gold-deep/30">
      <div className="marquee-track">
        {items.map((t, i) => (
          <span key={i} className="text-xs sm:text-sm font-semibold tracking-wide uppercase">
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
