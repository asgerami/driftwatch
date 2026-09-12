import { listProviders } from "../../lib/queries";

export const revalidate = 900;

export default async function ProvidersPage() {
  const providers = await listProviders();

  return (
    <main className="prose">
      <h1>Providers</h1>
      <p style={{ color: "var(--ink-2)" }}>
        Tier A sources only for now: specs tracked in a public git repo, which
        is what makes their whole history available rather than only what has
        happened since we started watching.
      </p>
      {providers.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>
            No providers yet. Run <code>pnpm w seed</code>.
          </p>
        </div>
      ) : (
        <ul className="providers">
          {providers.map((provider) => (
            <li key={provider.slug} className="provider">
              <a href={`/${provider.slug}`}>{provider.name}</a>
              <div className="provider-meta">
                {provider.snapshotCount} versions
                {provider.earliest ? ` · since ${provider.earliest.slice(0, 4)}` : ""}
              </div>
              <div className="provider-meta">
                {provider.breakingCount} breaking published
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
