import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyFeed, Release } from "../../../components/Change";
import { listProviders, recentReleases } from "../../../lib/queries";

export const revalidate = 300;

// Rendered on first request, then cached and revalidated (ISR).
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ api: string }>;
}): Promise<Metadata> {
  const { api } = await params;
  const provider = (await listProviders()).find((p) => p.slug === api);
  if (!provider) return { title: "API not found" };
  return {
    title: `${provider.name} API breaking changes`,
    description: `Every breaking change, deprecation and new field in the ${provider.name} API, read from its published OpenAPI spec. ${provider.snapshotCount} versions tracked.`,
    alternates: {
      canonical: `/apis/${api}`,
      types: {
        "application/rss+xml": `/apis/${api}/rss.xml`,
        "application/feed+json": `/apis/${api}/feed.json`,
      },
    },
  };
}

export default async function ProviderPage({
  params,
}: {
  params: Promise<{ api: string }>;
}) {
  const { api: slug } = await params;
  const providers = await listProviders();
  const provider = providers.find((p) => p.slug === slug);
  if (!provider) notFound();

  const releases = await recentReleases(50, slug);

  return (
    <main>
      <div className="prose">
        <h1>{provider.name}</h1>
        <p style={{ color: "var(--ink-2)" }}>
          {provider.snapshotCount} spec versions tracked
          {provider.earliest
            ? `, back to ${provider.earliest.slice(0, 10)}`
            : ""}
          . {provider.breakingCount} published breaking changes.
          {provider.docsUrl ? (
            <>
              {" "}
              <a href={provider.docsUrl} rel="noreferrer noopener">
                Provider docs
              </a>
              .
            </>
          ) : null}
        </p>
      </div>
      {releases.length === 0 ? (
        <EmptyFeed providerName={provider.name} snapshotCount={provider.snapshotCount} />
      ) : (
        releases.map((release) => <Release key={release.id} release={release} />)
      )}
    </main>
  );
}
