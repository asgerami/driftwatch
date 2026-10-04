/**
 * "Watch my repo" submissions: what counts as a real one.
 *
 * Pure, so render-check exercises every rejection without a database. The
 * form is plain HTML posting to /api/waitlist, so this is the only gate:
 * nothing typed into the form is trusted.
 */

/** Hidden field a person never fills and a form-filling bot usually does. */
export const HONEYPOT_FIELD = "website";
/** Hidden field holding when the form was rendered (ms since epoch). */
export const RENDERED_AT_FIELD = "t";
/** Faster than this from render to submit is not a person typing. */
export const MIN_FILL_MS = 2_000;
/** Older than this, the timestamp was copied, not rendered for this visit. */
export const MAX_FILL_MS = 24 * 60 * 60 * 1_000;

export const MAX_EMAIL = 254;
export const MAX_OTHER = 200;
export const MAX_APIS = 30;

export type WaitlistError =
  | "bot"
  | "email"
  | "repo"
  | "apis"
  | "other";

export interface WaitlistSubmission {
  email: string;
  repoUrl: string;
  apis: string[];
  otherApis?: string;
}

export type Validation = { ok: true; value: WaitlistSubmission } | { ok: false; error: WaitlistError };

export const ERROR_MESSAGES: Record<WaitlistError, string> = {
  bot: "That submission looked automated. If you're a person, reload the page and try again.",
  email: "That doesn't look like an email address.",
  repo: "Use the repo's GitHub URL, like https://github.com/owner/repo.",
  apis: "Pick at least one API you use.",
  other: `Keep the other APIs under ${MAX_OTHER} characters.`,
};

// Deliberately plain: one @, no spaces, a dot in the domain. Anything
// stricter rejects real addresses; this rejects the junk that matters.
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

// GitHub's own limits: owner 1–39 alphanumerics or single hyphens; repo
// names letters, digits, '.', '-', '_'.
const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})\/([A-Za-z0-9._-]{1,100})$/;

/** `github.com/o/r`, `https://github.com/o/r.git/`, `http://…` → `https://github.com/o/r`. */
export function normalizeRepoUrl(input: string): string | null {
  let value = input.trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  value = value
    .replace(/^http:\/\//i, "https://")
    .replace(/^https:\/\/(www\.)?github\.com/i, "https://github.com")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const match = GITHUB_REPO.exec(value);
  if (!match || match[2] === "." || match[2] === "..") return null;
  return `https://github.com/${match[1]}/${match[2]}`;
}

/** FormData entries can be uploaded files; any non-string counts as empty. */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function validateSubmission(
  form: { get(name: string): unknown; getAll(name: string): unknown[] },
  knownApis: ReadonlySet<string>,
  now: number = Date.now(),
): Validation {
  if (text(form.get(HONEYPOT_FIELD)).trim() !== "") return { ok: false, error: "bot" };
  const renderedAt = Number(text(form.get(RENDERED_AT_FIELD)) || NaN);
  const elapsed = now - renderedAt;
  if (!Number.isFinite(renderedAt) || elapsed < MIN_FILL_MS || elapsed > MAX_FILL_MS) {
    return { ok: false, error: "bot" };
  }

  const email = text(form.get("email")).trim().toLowerCase();
  if (email.length > MAX_EMAIL || !EMAIL.test(email)) return { ok: false, error: "email" };

  const repoUrl = normalizeRepoUrl(text(form.get("repo")));
  if (!repoUrl) return { ok: false, error: "repo" };

  const apis = [...new Set(form.getAll("apis").map((api) => text(api).trim()))];
  if (apis.length === 0 || apis.length > MAX_APIS || apis.some((api) => !knownApis.has(api))) {
    return { ok: false, error: "apis" };
  }

  const other = text(form.get("other")).trim();
  if (other.length > MAX_OTHER) return { ok: false, error: "other" };

  return { ok: true, value: { email, repoUrl, apis, otherApis: other || undefined } };
}
