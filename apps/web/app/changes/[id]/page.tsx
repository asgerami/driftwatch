import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StoryPage } from "../../../components/StoryPage";
import { getStory } from "../../../lib/queries";

// A published story changes only if a later ruleset reclassifies it.
export const revalidate = 3600;

// Rendered on first request, then cached and revalidated (ISR).
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const story = await getStory(id);
  if (!story) return { title: "Change not found" };
  const title = `${story.providerName}: ${story.change.headline}`;
  const description = story.change.body.split("\n\n")[0];
  return {
    title,
    description,
    alternates: { canonical: `/changes/${id}` },
    openGraph: {
      type: "article",
      title,
      description,
      url: `/changes/${id}`,
      publishedTime: story.shippedAt,
    },
  };
}

export default async function ChangePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = await getStory(id);
  if (!story) notFound();
  return <StoryPage story={story} />;
}
