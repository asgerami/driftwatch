import type { Metadata } from "next";

import { PullIcon } from "../../components/Marks";
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
    <main className="shell">
      <div className="watch">
        <div className="watch-intro">
          <h1>Get a pull request when an API breaks your code</h1>
          <p className="page-lede">
            The Driftwatch GitHub App checks your repository against the APIs it
            calls, and opens a pull request when a change breaks your code.
          </p>
          <p>
            Straightforward fixes arrive ready to review. Anything that needs a
            decision is flagged for your team, never guessed.
          </p>
          <p>The App is in early access. Tell us your repository and the APIs it uses, and you&rsquo;ll be among the first to try it.</p>

          <figure className="example-pr" aria-label="An example pull request">
            <div className="example-pr-head">
              <PullIcon />
              Rename protect_session_id to device_session_id, after Plaid&rsquo;s API change
            </div>
            <div className="example-pr-body">
              <p>Plaid renamed protect_session_id to device_session_id on POST /protect/event/send.</p>
              <pre className="diff">
                <span className="del">-    protect_session_id: sessionId,</span>
                <span className="add">+    device_session_id: sessionId,</span>
              </pre>
              <figcaption className="example-label">
                An example pull request for a real Plaid change, from a test repository.
              </figcaption>
            </div>
          </figure>
        </div>
        <WatchForm
          apis={providers.map((provider) => ({ slug: provider.slug, name: provider.name }))}
          renderedAt={Date.now()}
          joined={joined === "1"}
          error={knownError}
        />
      </div>
    </main>
  );
}
