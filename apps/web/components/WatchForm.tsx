import { ERROR_MESSAGES, HONEYPOT_FIELD, RENDERED_AT_FIELD, type WaitlistError } from "../lib/waitlist";
import { CheckIcon } from "./Marks";

/**
 * "Watch my repo". Plain HTML posting to /api/waitlist: no JavaScript needed,
 * and nothing here is trusted; lib/waitlist.ts validates every field.
 */
export function WatchForm({
  apis,
  renderedAt,
  joined,
  error,
}: {
  apis: { slug: string; name: string }[];
  renderedAt: number;
  joined?: boolean;
  error?: WaitlistError;
}) {
  if (joined) {
    return (
      <div className="joined" id="form" role="status">
        <h2>
          <CheckIcon size={20} /> You&rsquo;re on the list
        </h2>
        <p>
          When the GitHub App can open a pull request for your repo, you&rsquo;ll
          be among the first to hear. Apart from a confirmation, nothing else will
          be sent to that address.
        </p>
      </div>
    );
  }

  return (
    <form className="watch-form" id="form" method="post" action="/api/waitlist">
      {error ? (
        <p className="watch-error" role="alert">
          {ERROR_MESSAGES[error]}
        </p>
      ) : null}

      <label className="field">
        <span className="field-label">Email</span>
        <input type="email" name="email" required maxLength={254} autoComplete="email" />
      </label>

      <label className="field">
        <span className="field-label">GitHub repository</span>
        <input
          type="url"
          name="repo"
          required
          maxLength={200}
          placeholder="https://github.com/owner/repo"
        />
      </label>

      <fieldset>
        <legend className="field-label">APIs it calls</legend>
        <div className="watch-apis">
          {apis.map((api) => (
            <label key={api.slug} className="api-toggle">
              <input type="checkbox" name="apis" value={api.slug} />
              <span>
                <CheckIcon size={13} />
                {api.name}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="field">
        <span className="field-label">
          Others we don&rsquo;t watch yet <span className="field-help">(optional)</span>
        </span>
        <input type="text" name="other" maxLength={200} />
      </label>

      {/* Bots fill every field; people never see this one. */}
      <div className="watch-trap" aria-hidden="true">
        <label>
          Website
          <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <input type="hidden" name={RENDERED_AT_FIELD} value={renderedAt} />

      <button className="btn btn-lg" type="submit">
        Get early access
      </button>
      <p className="watch-note">
        Stored only to tell you when the GitHub App is ready. No newsletter, no
        sharing.
      </p>
    </form>
  );
}
