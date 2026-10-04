import { notFound } from "next/navigation";
import { EmptyFeed, Release } from "../../../components/Change";
import { listProviders, recentReleases } from "../../../lib/queries";

export const revalidate = 300;

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
