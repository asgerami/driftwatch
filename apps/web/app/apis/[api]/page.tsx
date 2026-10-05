import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyFeed, Release } from "../../../components/Change";
import { ArrowUpRight, BracesIcon, FeedIcon } from "../../../components/Marks";
import { ProviderLogo } from "../../../components/ProviderLogo";
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
    description: `Every breaking change, deprecation and new field in the ${provider.name} API, as it ships.`,
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
        <div className="api-title">
          <span className="api-logo">
            <ProviderLogo slug={slug} name={provider.name} size={30} />
          </span>
          <h1>{provider.name} API changes</h1>
        </div>
        <p className="page-lede">
          Breaking changes, deprecations and new fields in the {provider.name} API, as
          they ship.
        </p>
        <div className="subscribe-row">
          <a className="btn btn-ghost btn-sm" href={`/apis/${slug}/rss.xml`}>
            <FeedIcon size={14} /> RSS
          </a>
          <a className="btn btn-ghost btn-sm" href={`/apis/${slug}/feed.json`}>
            <BracesIcon size={14} /> JSON Feed
          </a>
          {provider.docsUrl ? (
            <a className="btn btn-ghost btn-sm" href={provider.docsUrl} rel="noreferrer noopener">
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
