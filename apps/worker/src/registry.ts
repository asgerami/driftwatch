/**
 * The seed list.
 *
 * Tier A sources are a spec tracked in a public git repo — history is free,
 * which is why the feed can launch with an archive. Tier B sources are a
 * spec at a stable hosted URL; ingest is identical, only acquisition differs,
 * and the first snapshot is "now" rather than years of commits.
 *
 * For tier A, `filePathCandidates` is ordered by preference. `seed` clones
 * each repo and takes the first candidate that actually exists at HEAD, so a
 * wrong guess fails loudly at seed time instead of silently producing no
 * snapshots. Run `discover <slug>` to list what a repo really contains.
 */

export interface RegistrySource {
  key: string;
  label: string;
  /** Default A when omitted. */
  tier?: "A" | "B";
  /** Tier A: GitHub-style "owner/repo". */
  repo?: string;
  /** Tier A. Ordered guesses; seed resolves the first that exists at HEAD. */
  filePathCandidates?: string[];
  /** Tier B: stable hosted spec URL. */
  url?: string;
  /** Stripped before hashing. See SpecSource.volatilePointers. */
  volatilePointers?: string[];
  /**
   * Tier A. Default true. False when each API version is its own file, so
   * history stays on this version instead of stitching earlier versions in.
   * See fileHistory.
   */
  followRenames?: boolean;
}

export function sourceTier(source: RegistrySource): "A" | "B" {
  return source.tier ?? (source.url && !source.repo ? "B" : "A");
}

export const CATEGORIES = [
  "payments",
  "communications",
  "ai",
  "developer-platform",
  "infrastructure",
  "productivity",
  "identity",
  "commerce",
  "media",
  "observability",
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface RegistryProvider {
  slug: string;
  name: string;
  category: Category;
  docsUrl: string;
  sources: RegistrySource[];
}

export const REGISTRY: RegistryProvider[] = [
  {
    slug: "stripe",
    category: "payments",
    name: "Stripe",
    docsUrl: "https://docs.stripe.com/api",
    sources: [
      {
        key: "api",
        label: "Stripe API",
        repo: "stripe/openapi",
        filePathCandidates: [
          "openapi/spec3.json",
          "openapi/spec3.yaml",
          "openapi/spec3.sdk.json",
        ],
        // Stripe stamps the generator version into info; it moves on every
        // publish whether or not the surface changed.
        volatilePointers: ["/info/version"],
      },
    ],
  },
  {
    slug: "openai",
    category: "ai",
    name: "OpenAI",
    docsUrl: "https://platform.openai.com/docs/api-reference",
    sources: [
      {
        key: "api",
        label: "OpenAI API",
        repo: "openai/openai-openapi",
        filePathCandidates: ["openapi.yaml", "openapi.json"],
      },
    ],
  },
  {
    slug: "twilio",
    category: "communications",
    name: "Twilio",
    docsUrl: "https://www.twilio.com/docs/api",
    sources: [
      {
        key: "api_v2010",
        label: "Twilio Core API (2010-04-01)",
        repo: "twilio/twilio-oai",
        filePathCandidates: [
          "spec/json/twilio_api_v2010.json",
          "spec/yaml/twilio_api_v2010.yaml",
        ],
      },
      {
        key: "messaging_v1",
        label: "Twilio Messaging v1",
        repo: "twilio/twilio-oai",
        filePathCandidates: [
          "spec/json/twilio_messaging_v1.json",
          "spec/yaml/twilio_messaging_v1.yaml",
        ],
      },
    ],
  },
  {
    slug: "github",
    category: "developer-platform",
    name: "GitHub",
    docsUrl: "https://docs.github.com/rest",
    sources: [
      {
        key: "rest",
        label: "GitHub REST API",
        repo: "github/rest-api-description",
        filePathCandidates: [
          "descriptions/api.github.com/api.github.com.json",
          "descriptions/api.github.com/api.github.com.yaml",
        ],
      },
    ],
  },
  {
    slug: "hetzner",
    category: "infrastructure",
    name: "Hetzner",
    docsUrl: "https://docs.hetzner.cloud/",
    sources: [
      {
        key: "cloud",
        label: "Hetzner Cloud API",
        tier: "B",
        url: "https://docs.hetzner.cloud/cloud.spec.json",
      },
    ],
  },
  // One spec per product; Mail Send is the one nearly every integration calls.
  {
    slug: "sendgrid",
    category: "communications",
    name: "SendGrid",
    docsUrl: "https://www.twilio.com/docs/sendgrid/api-reference",
    sources: [
      {
        key: "mail",
        label: "SendGrid Mail Send v3",
        repo: "twilio/sendgrid-oai",
        filePathCandidates: [
          "spec/json/tsg_mail_v3.json",
          "spec/yaml/tsg_mail_v3.yaml",
        ],
      },
    ],
  },
  // Named after the API version it describes.
  {
    slug: "plaid",
    category: "payments",
    name: "Plaid",
    docsUrl: "https://plaid.com/docs/api/",
    sources: [
      {
        key: "api",
        label: "Plaid API (2020-09-14)",
        repo: "plaid/plaid-openapi",
        filePathCandidates: [
          "2020-09-14.yml",
        ],
      },
    ],
  },
  // One file per API version, and callers pin a version: a new major is a new file,
  // so this tracks v72 and needs a registry change when Adyen ships v73.
  {
    slug: "adyen",
    category: "payments",
    name: "Adyen",
    docsUrl: "https://docs.adyen.com/api-explorer/",
    sources: [
      {
        key: "checkout",
        label: "Adyen Checkout API v72",
        repo: "Adyen/adyen-openapi",
        followRenames: false,
        filePathCandidates: [
          "json/CheckoutService-v72.json",
          "yaml/CheckoutService-v72.yaml",
        ],
      },
    ],
  },
  {
    slug: "square",
    category: "commerce",
    name: "Square",
    docsUrl: "https://developer.squareup.com/reference/square",
    sources: [
      {
        key: "api",
        label: "Square API",
        repo: "square/connect-api-specification",
        filePathCandidates: [
          "api.json",
        ],
      },
    ],
  },
  // 25 MB, the largest spec tracked.
  {
    slug: "cloudflare",
    category: "infrastructure",
    name: "Cloudflare",
    docsUrl: "https://developers.cloudflare.com/api/",
    sources: [
      {
        key: "api",
        label: "Cloudflare API",
        repo: "cloudflare/api-schemas",
        filePathCandidates: [
          "openapi.json",
          "openapi.yaml",
        ],
      },
    ],
  },
  {
    slug: "discord",
    category: "communications",
    name: "Discord",
    docsUrl: "https://discord.com/developers/docs/reference",
    sources: [
      {
        key: "api",
        label: "Discord HTTP API",
        repo: "discord/discord-api-spec",
        filePathCandidates: [
          "specs/openapi.json",
        ],
      },
    ],
  },
  {
    slug: "pagerduty",
    category: "observability",
    name: "PagerDuty",
    docsUrl: "https://developer.pagerduty.com/api-reference/",
    sources: [
      {
        key: "rest",
        label: "PagerDuty REST API",
        repo: "PagerDuty/api-schema",
        filePathCandidates: [
          "reference/REST/openapiv3.json",
        ],
      },
    ],
  },
  {
    slug: "asana",
    category: "productivity",
    name: "Asana",
    docsUrl: "https://developers.asana.com/reference",
    sources: [
      {
        key: "api",
        label: "Asana API",
        repo: "Asana/openapi",
        followRenames: false,
        filePathCandidates: [
          "defs/asana_oas.yaml",
        ],
      },
    ],
  },
  {
    slug: "box",
    category: "productivity",
    name: "Box",
    docsUrl: "https://developer.box.com/reference/",
    sources: [
      {
        key: "api",
        label: "Box Platform API",
        repo: "box/box-openapi",
        filePathCandidates: [
          "openapi.json",
          "openapi/openapi.json",
        ],
      },
    ],
  },
  // Published with the official clients; there is no standalone spec repo.
  {
    slug: "datadog",
    category: "observability",
    name: "Datadog",
    docsUrl: "https://docs.datadoghq.com/api/",
    sources: [
      {
        key: "v2",
        label: "Datadog API v2",
        repo: "DataDog/datadog-api-client-typescript",
        filePathCandidates: [
          ".generator/schemas/v2/openapi.yaml",
        ],
      },
    ],
  },
  {
    slug: "resend",
    category: "communications",
    name: "Resend",
    docsUrl: "https://resend.com/docs/api-reference",
    sources: [
      {
        key: "api",
        label: "Resend API",
        repo: "resend/resend-openapi",
        filePathCandidates: [
          "resend.yaml",
          "resend.json",
        ],
      },
    ],
  },
  // Dated API versions, one file each, like Adyen: tracks the newest.
  {
    slug: "clerk",
    category: "identity",
    name: "Clerk",
    docsUrl: "https://clerk.com/docs/reference/backend-api",
    sources: [
      {
        key: "backend",
        label: "Clerk Backend API (2026-05-12)",
        repo: "clerk/openapi-specs",
        followRenames: false,
        filePathCandidates: [
          "bapi/2026-05-12.yml",
        ],
      },
    ],
  },
  {
    slug: "jira",
    category: "productivity",
    name: "Jira Cloud",
    docsUrl: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/",
    sources: [
      {
        key: "platform",
        label: "Jira Cloud Platform REST API v3",
        tier: "B",
        url: "https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json",
      },
    ],
  },
  {
    slug: "vercel",
    category: "infrastructure",
    name: "Vercel",
    docsUrl: "https://vercel.com/docs/rest-api",
    sources: [
      {
        key: "api",
        label: "Vercel REST API",
        tier: "B",
        url: "https://openapi.vercel.sh/",
      },
    ],
  },
  {
    slug: "zoom",
    category: "communications",
    name: "Zoom",
    docsUrl: "https://developers.zoom.us/docs/api/",
    sources: [
      {
        key: "meetings",
        label: "Zoom Meetings API",
        tier: "B",
        url: "https://developers.zoom.us/api-hub/meetings/methods/endpoints.json",
      },
    ],
  },
  {
    slug: "mux",
    category: "media",
    name: "Mux",
    docsUrl: "https://docs.mux.com/api-reference",
    sources: [
      {
        key: "api",
        label: "Mux API",
        tier: "B",
        url: "https://www.mux.com/api-spec.json",
      },
    ],
  },
];

export function findProvider(slug: string): RegistryProvider | undefined {
  return REGISTRY.find((p) => p.slug === slug);
}

/** History options for a stored source, looked up by provider slug and key. */
export function historyOptions(slug: string, key: string): { followRenames?: boolean } {
  const source = findProvider(slug)?.sources.find((s) => s.key === key);
  return source?.followRenames === false ? { followRenames: false } : {};
}
