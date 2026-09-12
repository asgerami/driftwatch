/**
 * The seed list.
 *
 * Only tier A sources are here, because a git-tracked spec gives us commit
 * history and therefore an archive on day one rather than an empty page.
 *
 * `filePathCandidates` is ordered by preference. `seed` clones each repo and
 * takes the first candidate that actually exists at HEAD, so a wrong guess
 * here fails loudly at seed time instead of silently producing no snapshots.
 * Run `discover <slug>` to list what a repo really contains.
 */

export interface RegistrySource {
  key: string;
  label: string;
  repo: string;
  filePathCandidates: string[];
  /** Stripped before hashing. See SpecSource.volatilePointers. */
  volatilePointers?: string[];
}

export interface RegistryProvider {
  slug: string;
  name: string;
  docsUrl: string;
  sources: RegistrySource[];
}

export const REGISTRY: RegistryProvider[] = [
  {
    slug: "stripe",
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
];

export function findProvider(slug: string): RegistryProvider | undefined {
  return REGISTRY.find((p) => p.slug === slug);
}
