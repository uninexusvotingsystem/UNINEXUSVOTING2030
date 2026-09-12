import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://unx-awards.vercel.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/nominate`, changeFrequency: "weekly", priority: 0.8 },
  ];

  try {
    const supabase = createClient();
    const { data: categories } = await supabase.from("categories").select("slug, voting_open");
    const voteRoutes: MetadataRoute.Sitemap = (categories || [])
      .filter((c) => c.voting_open)
      .map((c) => ({ url: `${SITE_URL}/vote/${c.slug}`, changeFrequency: "daily" as const, priority: 0.7 }));
    return [...staticRoutes, ...voteRoutes];
  } catch {
    return staticRoutes;
  }
}
