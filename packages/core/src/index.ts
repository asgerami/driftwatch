export {
  normalizeSpec,
  parseSpecText,
  detectVersion,
  collectStats,
  sha256,
  canonicalizeDocument,
  serializeCanonical,
  stripPointers,
  parsePointer,
} from "./normalize/index.js";

export {
  HTTP_METHODS,
  type Json,
  type JsonObject,
  type HttpMethod,
  type NormalizeOptions,
  type NormalizedSpec,
  type SpecStats,
} from "./types.js";

export {
  diffDocuments,
  classify,
  fingerprintOf,
  LOCATION_KEYED_RULES,
  RULESET_VERSION,
  RULES,
  ruleFor,
  PUBLISH_CONFIDENCE_THRESHOLD,
  flattenAllOf,
  resolveRef,
  pointer,
  type Change,
  type DiffResult,
  type Severity,
  type Rule,
  type RawChange,
  type Direction,
} from "./diff/index.js";

export { renderImpact, enrich, type RenderedImpact } from "./impact/index.js";

export {
  storyKeyOf,
  groupStories,
  parentOf,
  PARENT_STORY_MIN_FIELDS,
  storyDetail,
  leafOf,
  type StoryInput,
} from "./diff/story.js";
