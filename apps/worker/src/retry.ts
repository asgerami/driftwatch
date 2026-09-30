/**
 * Retry a network operation with backoff.
 *
 * One flaky connection used to fail a source for the whole 6-hour window
 * until the next scheduled run. Three attempts, 1s then 4s apart, rides out a
 * brief drop without hiding a real outage: a source that is really down still
 * fails within seconds and is recorded as failing.
 */

export class PermanentError extends Error {
  // A 4xx, or anything else retrying cannot fix. Thrown through untouched.
}

export interface RetryOptions {
  attempts?: number;
  /** Injected in tests so they do not wait. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      if (err instanceof PermanentError) throw err;
      lastError = err;
      if (attempt < attempts) await sleep(1000 * 4 ** (attempt - 1));
    }
  }
  throw lastError;
}
