import type { Metadata } from "next";

import { WatchForm } from "../../components/WatchForm";
import { listProviders } from "../../lib/queries";
import { ERROR_MESSAGES, type WaitlistError } from "../../lib/waitlist";

// Each visit needs its own render timestamp for the bot check, so no caching.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Watch my repo",
  description:
    "Get a pull request when a third-party API change breaks code in your repo. Join the waitlist for the Driftwatch GitHub App.",
  alternates: { canonical: "/watch" },
};

export default async function WatchPage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string; error?: string }>;
}) {
  const { joined, error } = await searchParams;
  const providers = await listProviders();
  const knownError = error && error in ERROR_MESSAGES ? (error as WaitlistError) : undefined;

  return (
    <main className="prose">
      <h1>Watch my repo</h1>
      <p>
        The feed tells you when a vendor changed its API. The next step reads
        your code instead: a GitHub App that finds where your repo calls the
        APIs you depend on, and opens a pull request when a change breaks one of
        those calls.
      </p>
      <p>
        It isn&rsquo;t built yet. Tell us which repo and which APIs, and
        you&rsquo;ll be among the first to try it.
      </p>
      <WatchForm
        apis={providers.map((provider) => ({ slug: provider.slug, name: provider.name }))}
        renderedAt={Date.now()}
        joined={joined === "1"}
        error={knownError}
      />
    </main>
  );
}
