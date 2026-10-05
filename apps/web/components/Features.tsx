import {
  ArrowsLeftRight,
  Code,
  GitPullRequest,
  Scales,
  Broadcast,
  RssSimple,
} from "@phosphor-icons/react/ssr";

/** What Driftwatch does, as a bento grid: two large cells with real material, four small. */
export function Features() {
  return (
    <div className="bento">
      <article className="bento-cell bento-wide">
        <div className="bento-icon">
          <Broadcast size={22} weight="duotone" />
        </div>
        <h3>21 APIs, checked every six hours</h3>
        <p>
          Stripe, OpenAI, GitHub, Cloudflare and more, read from their published
          OpenAPI specs. When one changes, you hear about it here first.
        </p>
        <div className="bento-pings" aria-hidden="true">
          <span data-severity="BREAKING">Stripe · payment_method_types removed</span>
          <span data-severity="BEHAVIORAL">OpenAI · 201 now documented</span>
          <span data-severity="BREAKING">Vercel · abuse removed</span>
        </div>
      </article>
      <article className="bento-cell bento-tall">
        <div className="bento-icon">
          <Code size={22} weight="duotone" />
        </div>
        <h3>The code that breaks</h3>
        <p>Every change comes with the call pattern that fails, so you can search your repo for it.</p>
        <pre className="bento-code">{`switch (payment.status) {
  case "succeeded": …
  case "failed": …
  // "requires_review"
  // has no branch
}`}</pre>
      </article>
      <article className="bento-cell">
        <div className="bento-icon">
          <GitPullRequest size={22} weight="duotone" />
        </div>
        <h3>A fix, as a pull request</h3>
        <p>The GitHub App patches renamed and removed fields, and checks the types first.</p>
      </article>
      <article className="bento-cell">
        <div className="bento-icon">
          <ArrowsLeftRight size={22} weight="duotone" />
        </div>
        <h3>Read from your side</h3>
        <p>Three changes other diff tools call safe are flagged as the breaks they are for you.</p>
      </article>
      <article className="bento-cell">
        <div className="bento-icon">
          <Scales size={22} weight="duotone" />
        </div>
        <h3>Rules, not guesses</h3>
        <p>Severity comes from fixed, published rules. The same change is always classified the same way.</p>
      </article>
      <article className="bento-cell bento-span">
        <div className="bento-icon">
          <RssSimple size={22} weight="duotone" />
        </div>
        <h3>Wherever you read</h3>
        <p>RSS and JSON feeds for every API, or for only the ones you use.</p>
      </article>
    </div>
  );
}
