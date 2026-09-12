import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ArrowRight, Ticket } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { VoteWidget } from "@/components/vote-widget";
import { SiteFooter } from "@/components/site-footer";
import { MAIN_SITE_URL, GALA_TICKETS_URL } from "@/lib/constants";

async function getCategory(slug: string) {
  const supabase = createClient();
  const { data: category } = await supabase.from("categories").select("*").eq("slug", slug).maybeSingle();
  if (!category) return { category: null, nominees: [] };

  const { data: nominees } = await supabase
    .from("nominees")
    .select("*")
    .eq("category_id", category.id)
    .eq("status", "approved")
    .order("sort_order", { ascending: true });

  let nomineesWithMedia = nominees || [];
  if (nomineesWithMedia.length > 0) {
    const { data: media } = await supabase
      .from("nominee_media")
      .select("*")
      .in("nominee_id", nomineesWithMedia.map((n: any) => n.id))
      .order("sort_order", { ascending: true });
    nomineesWithMedia = nomineesWithMedia.map((n: any) => ({
      ...n,
      media: (media || []).filter((m: any) => m.nominee_id === n.id),
    }));
  }

  return { category, nominees: nomineesWithMedia };
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const { category } = await getCategory(params.slug);
  if (!category) return {};
  return {
    title: `Vote — ${category.name}`,
    description: category.description || `Vote for your favourite nominee in ${category.name}.`,
  };
}

export default async function VoteCategoryPage({ params }: { params: { slug: string } }) {
  const { category, nominees } = await getCategory(params.slug);
  if (!category || !category.voting_open) notFound();

  return (
    <div className="bg-cream min-h-screen">
      <section className="surface-ink py-14 sm:py-20 text-center">
        <div className="container max-w-2xl">
          <Link href="/" className="inline-flex items-center gap-1 text-cream/60 hover:text-gold text-sm mb-4">
            <ChevronLeft className="size-4" /> All categories
          </Link>
          <h1 className="heading-display text-3xl sm:text-5xl text-cream">{category.name}</h1>
          {category.description && <p className="mt-3 text-cream/60">{category.description}</p>}
        </div>
      </section>

      <section className="container py-14 sm:py-20">
        {nominees.length === 0 ? (
          <div className="card-elegant p-10 text-center text-ink/50">Nominees for this category are coming soon.</div>
        ) : (
          <VoteWidget categoryId={category.id} nominees={nominees} />
        )}

        <div className="mt-14 card-elegant p-8 text-center max-w-xl mx-auto">
          <h3 className="font-display text-xl mb-2">Attending the Gala?</h3>
          <p className="text-sm text-ink/60 mb-4">Get your tickets to the UniNexus Connect Gala Awards — this year's winners are announced live.</p>
          <a href={GALA_TICKETS_URL} target="_blank" rel="noreferrer" className="btn-gold inline-flex !py-3 !px-6">
            <Ticket className="size-4" /> Buy tickets
          </a>
        </div>

        <div className="mt-6 card-elegant p-8 text-center max-w-xl mx-auto">
          <h3 className="font-display text-xl mb-2">Not a member yet?</h3>
          <p className="text-sm text-ink/60 mb-4">Join UniNexus Connect to follow every category, event and update across Kenyan universities.</p>
          <a href={`${MAIN_SITE_URL}/auth`} className="btn-gold inline-flex !py-3 !px-6">
            Join UniNexus Connect <ArrowRight className="size-4" />
          </a>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
