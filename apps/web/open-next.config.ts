import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import memoryQueue from "@opennextjs/cloudflare/overrides/queue/memory-queue";

/**
 * Pages are cached in R2 (NEXT_INC_CACHE_R2_BUCKET) and served from there;
 * a page past its `revalidate` time is served stale while the memory queue
 * asks the Worker itself (WORKER_SELF_REFERENCE) to re-render it, as its own
 * request with its own CPU budget. No Durable Objects needed.
 */
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  queue: memoryQueue,
});
