import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyFeed, Release } from "../../../components/Change";
import { ArrowUpRight, BracesIcon, FeedIcon } from "../../../components/Marks";
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
    <main className="shell">
      <header className="page-head">
        <p className="crumbs">
          <a href="/providers">APIs</a> / {provider.name}
        </p>
        <h1>{provider.name} API changes</h1>
        <p className="page-lede">
          {provider.breakingCount} published breaking{" "}
          {provider.breakingCount === 1 ? "change" : "changes"}, from{" "}
          {provider.snapshotCount} {provider.snapshotCount === 1 ? "version" : "versions"} of its
          spec
          {provider.earliest ? (
            <>
              {" read since "}
              <time dateTime={provider.earliest}>{provider.earliest.slice(0, 10)}</time>
            </>
          ) : null}
          .
        </p>
        <div className="subscribe-row">
          <a href={`/apis/${slug}/rss.xml`}>
            <FeedIcon size={14} /> RSS
          </a>
          <a href={`/apis/${slug}/feed.json`}>
            <BracesIcon size={14} /> JSON Feed
          </a>
          {provider.docsUrl ? (
            <a href={provider.docsUrl} rel="noreferrer noopener">
              <ArrowUpRight size={14} /> {provider.name} docs
            </a>
          ) : null}
        </div>
      </header>
      {releases.length === 0 ? (
        <EmptyFeed providerName={provider.name} snapshotCount={provider.snapshotCount} />
      ) : (
        <div className="feed">
          {releases.map((release) => (
            <Release key={release.id} release={release} />
          ))}
        </div>
      )}
    </main>
  );
}
