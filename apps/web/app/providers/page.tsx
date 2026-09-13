import { listProviders } from "../../lib/queries";
import { stationId } from "../../lib/stations";
import type { Metadata } from "next";

export const revalidate = 900;

export const metadata: Metadata = {
  title: "Stations · Driftwatch",
};

export default async function ProvidersPage() {
  const providers = await listProviders();

  return (
    <main className="prose">
      <h1>Stations</h1>
      <p>
        Specs a team depends on. Git-tracked sources arrive with years of
        history; hosted URLs start from the first poll. IDs are ours — not
        vendor marks.
      </p>
      {providers.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>
            No stations yet. Run <code>pnpm w seed</code>.
          </p>
        </div>
      ) : (
        <ul className="providers">
          {providers.map((provider) => (
            <li key={provider.slug} className="provider">
              <span className="station">{stationId(provider.slug)}</span>
              <a className="name" href={`/${provider.slug}`}>
                {provider.name}
              </a>
              <div className="provider-meta">
                {provider.snapshotCount}{" "}
                {provider.snapshotCount === 1 ? "version" : "versions"}
                {provider.earliest ? ` · since ${provider.earliest.slice(0, 4)}` : ""}
              </div>
              <div className="provider-meta">
                {provider.breakingCount} hook returns published
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
