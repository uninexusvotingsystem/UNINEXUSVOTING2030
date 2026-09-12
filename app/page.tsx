import Link from "next/link";
import { ArrowRight, Trophy, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

const MAIN_SITE_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "https://uninexusconnectplatform.co.ke";

async function getCategories() {
  const supabase = createClient();
  const { data } = await supabase.from("categories").select("*").order("sort_order", { ascending: true });
  return data || [];
}

export default async function HomePage() {
  const categories = await getCategories();

  return (
    <div className="bg-cream min-h-screen">
      <section className="surface-ink py-20 sm:py-28 text-center">
        <div className="container max-w-2xl">
          <p className="eyebrow mb-4">UNX Awards</p>
          <h1 className="heading-display text-4xl sm:text-6xl text-cream mb-5">Nominate. Vote. Celebrate.</h1>
          <p className="text-cream/65 leading-relaxed">
            Recognizing the people who make campuses across Kenya extraordinary — nominate someone, or cast your vote once nominations close.
          </p>
        </div>
      </section>

      <section className="container py-14 sm:py-20">
        <div className="grid gap-5">
          {categories.map((c) => (
            <div key={c.id} className="card-elegant p-7 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl mb-1">{c.name}</h2>
                {c.description && <p className="text-sm text-ink/60 max-w-xl">{c.description}</p>}
                <p className="text-xs uppercase tracking-wider text-gold-deep mt-2">
                  {c.nominations_open && "Nominations open"}
                  {c.nominations_open && c.voting_open && " · "}
                  {c.voting_open && "Voting open"}
                  {!c.nominations_open && !c.voting_open && "Closed"}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                {c.nominations_open && (
                  <Link href={`/nominate?category=${c.slug}`} className="btn-outline-gold !py-2.5 !px-5 text-sm">
                    <UserPlus className="size-4" /> Nominate
                  </Link>
                )}
                {c.voting_open && (
                  <Link href={`/vote/${c.slug}`} className="btn-gold !py-2.5 !px-5 text-sm">
                    <Trophy className="size-4" /> Vote
                  </Link>
                )}
              </div>
            </div>
          ))}
          {categories.length === 0 && (
            <div className="card-elegant p-10 text-center text-ink/50">Categories are being set up — check back soon.</div>
          )}
        </div>

        <div className="mt-14 card-elegant p-8 text-center max-w-xl mx-auto">
          <h3 className="font-display text-xl mb-2">Not a UniNexus Connect member yet?</h3>
          <p className="text-sm text-ink/60 mb-4">Join UniNexus Connect to follow every event, category and update across Kenyan universities.</p>
          <a href={`${MAIN_SITE_URL}/auth`} className="btn-gold inline-flex !py-3 !px-6">
            Join UniNexus Connect <ArrowRight className="size-4" />
          </a>
        </div>
      </section>
    </div>
  );
}
