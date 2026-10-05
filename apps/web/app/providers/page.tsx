import type { Metadata } from "next";

import { ProviderLogo } from "../../components/ProviderLogo";
import { listProviders } from "../../lib/queries";

export const metadata: Metadata = {
  title: "APIs watched",
  description: "Every third-party API Driftwatch watches for breaking changes, with how far back each one's history goes.",
  alternates: { canonical: "/providers" },
};

export const revalidate = 900;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default async function ProvidersPage() {
  const providers = await listProviders();
  const most = Math.max(1, ...providers.map((p) => p.breakingCount));

  return (
    <main className="shell">
      <header className="page-head">
        <h1>APIs watched</h1>
        <p className="page-lede">
          Every API Driftwatch watches, with its published breaking changes and how
          far back its history goes.
        </p>
      </header>
      {providers.length === 0 ? (
        <div className="empty">
          <p>No APIs are being watched yet.</p>
        </div>
      ) : (
        <div className="catalogue-wrap">
        <table className="catalogue">
          <thead>
            <tr>
              <th scope="col">API</th>
              <th scope="col" className="num">
                Breaking changes
              </th>
              <th scope="col" className="num hide-sm">
                Versions read
              </th>
              <th scope="col" className="num hide-sm">
                History from
              </th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <tr key={provider.slug}>
                <td>
                  <a className="api-name" href={`/apis/${provider.slug}`}>
                    <ProviderLogo slug={provider.slug} name={provider.name} size={20} />
                    {provider.name}
                  </a>
                </td>
                <td className="num">
                  {provider.breakingCount > 0 ? (
                    <span
                      className="bar"
                      style={{ width: `${Math.max(2, Math.round((provider.breakingCount / most) * 96))}px` }}
                      aria-hidden="true"
                    />
                  ) : null}
                  {provider.breakingCount}
                </td>
                <td className="num hide-sm quiet">{plural(provider.snapshotCount, "version")}</td>
                <td className="num hide-sm quiet">
                  {provider.earliest ? (
                    <time dateTime={provider.earliest}>{provider.earliest.slice(0, 7)}</time>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </main>
  );
}
