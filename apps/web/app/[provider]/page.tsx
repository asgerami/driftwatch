import { notFound } from "next/navigation";
import { EmptyFeed, Release } from "../../components/Change";
import { listProviders, recentReleases } from "../../lib/queries";
import { stationId } from "../../lib/stations";

export const revalidate = 300;

export default async function ProviderPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider: slug } = await params;
  const providers = await listProviders();
  const provider = providers.find((p) => p.slug === slug);
  if (!provider) notFound();

  const releases = await recentReleases(50, slug);

  return (
    <main>
      <div className="prose">
        <h1>
          <span className="station">{stationId(slug)}</span> {provider.name}
        </h1>
        <p style={{ color: "var(--dim)" }}>
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
        <EmptyFeed providerSlug={slug} snapshotCount={provider.snapshotCount} />
      ) : (
        releases.map((release) => <Release key={release.id} release={release} />)
      )}
    </main>
  );
}
