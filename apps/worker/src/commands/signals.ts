import { PUBLISH_CONFIDENCE_THRESHOLD, RULESET_VERSION } from "@driftwatch/core";

import { config } from "../config.js";
import { prisma } from "../db.js";
import { sourceHealth } from "../health.js";
import { log } from "../log.js";

/**
 * The numbers the week-6 decision rests on (brief, section 6): are people
 * reading, subscribing, signing up, and merging fix PRs? Printed, not a
 * dashboard. Sources that are failing or stale are printed too, so a quiet
 * week cannot be a broken pipeline in disguise.
 */

/**
 * Only real visits to the public site. Cloudflare also records page loads on
 * Netlify's internal deploy hostnames (<hash>--driftwatchhq.netlify.app),
 * which are Netlify's own checks, not readers, and the same account holds
 * unrelated sites. Filtering by host needs only Account Analytics: Read; the
 * site-list endpoint would need a wider token.
 */
const SITE_HOSTS = (process.env["SITE_HOSTS"] ?? "driftwatch.et,www.driftwatch.et").split(",");

export interface Signals {
  days: number;
  views:
    | { available: true; total: number; changePages: number; apiPages: number; top: { path: string; count: number }[] }
    | { available: false; reason: string };
  feeds: { total: number; byPath: { path: string; count: number }[] };
  waitlist: { total: number; recent: number; byApi: { api: string; count: number }[] };
  fixPrs: { opened: number; merged: number; closed: number; open: number; refreshFailures: number };
  health: { unhealthy: { name: string; reason: string }[]; pendingReview: number };
}

export function formatSignals(s: Signals): string {
  const lines: string[] = [`Driftwatch signals, last ${s.days} days`, ""];

  lines.push("Page views (Cloudflare Web Analytics)");
  if (s.views.available) {
    lines.push(`  ${s.views.total} total · ${s.views.changePages} on change pages · ${s.views.apiPages} on API pages`);
    for (const page of s.views.top) lines.push(`  ${String(page.count).padStart(6)}  ${page.path}`);
  } else {
    lines.push(`  unavailable: ${s.views.reason}`);
  }
  lines.push("");

  lines.push("Feed fetches (lower bound: the CDN answers repeats within 5 minutes)");
  lines.push(`  ${s.feeds.total} total`);
  for (const feed of s.feeds.byPath.slice(0, 10)) lines.push(`  ${String(feed.count).padStart(6)}  ${feed.path}`);
  lines.push("");

  lines.push("Waitlist");
  lines.push(`  ${s.waitlist.total} signups, ${s.waitlist.recent} in the last ${s.days} days`);
  for (const api of s.waitlist.byApi) lines.push(`  ${String(api.count).padStart(6)}  ${api.api}`);
  lines.push("");

  lines.push("Fix PRs");
  lines.push(
    `  ${s.fixPrs.opened} opened · ${s.fixPrs.merged} merged · ${s.fixPrs.closed} closed unmerged · ${s.fixPrs.open} still open`,
  );
  if (s.fixPrs.refreshFailures > 0) {
    lines.push(`  ${s.fixPrs.refreshFailures} could not be refreshed from GitHub; states may be stale`);
  }
  lines.push("");

  lines.push("Pipeline");
  lines.push(`  ${s.health.pendingReview} stories waiting for review`);
  if (s.health.unhealthy.length === 0) lines.push("  every source fetching");
  for (const source of s.health.unhealthy) lines.push(`  NOT FETCHING ${source.name}: ${source.reason}`);

  return lines.join("\n");
}

export async function signals(options: { days?: number } = {}): Promise<void> {
  const days = options.days ?? 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceDay = since.toISOString().slice(0, 10);

  const [views, feedRows, entries, fixPrs, sources, pendingReview] = await Promise.all([
    pageViews(since),
    prisma.feedFetch.findMany({ where: { day: { gte: sinceDay } } }),
    prisma.waitlistEntry.findMany({ select: { apis: true, createdAt: true } }),
    refreshFixPrs(),
    prisma.specSource.findMany({ include: { provider: { select: { slug: true } } } }),
    prisma.change.count({
      where: {
        publishedAt: null,
        reviewedAt: null,
        confidence: { gte: PUBLISH_CONFIDENCE_THRESHOLD },
        severity: { not: "COSMETIC" },
        run: { rulesetVer: RULESET_VERSION, to: { source: { active: true } } },
      },
    }),
  ]);

  const byPath = new Map<string, number>();
  for (const row of feedRows) byPath.set(row.path, (byPath.get(row.path) ?? 0) + row.count);
  const byApi = new Map<string, number>();
  for (const entry of entries) for (const api of entry.apis) byApi.set(api, (byApi.get(api) ?? 0) + 1);

  const now = new Date();
  const result: Signals = {
    days,
    views,
    feeds: {
      total: [...byPath.values()].reduce((a, b) => a + b, 0),
      byPath: [...byPath].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count),
    },
    waitlist: {
      total: entries.length,
      recent: entries.filter((entry) => entry.createdAt >= since).length,
      byApi: [...byApi].map(([api, count]) => ({ api, count })).sort((a, b) => b.count - a.count),
    },
    fixPrs,
    health: {
      pendingReview,
      unhealthy: sources
        .map((source) => ({ name: `${source.provider.slug}/${source.key}`, health: sourceHealth(source, now) }))
        .filter(({ health }) => health.state === "failing" || health.state === "stale")
        .map(({ name, health }) => ({ name, reason: health.reason ?? health.state })),
    },
  };
  console.log(formatSignals(result));
}

/** Cloudflare's account id is the subdomain of the R2 endpoint. */
function accountId(): string | undefined {
  return process.env["CF_ACCOUNT_ID"] ?? config.r2.baseUrl.match(/^https:\/\/([0-9a-f]{32})\./)?.[1];
}

async function cloudflare(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      authorization: `Bearer ${process.env["CF_API_TOKEN"]}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await response.json()) as { success?: boolean; errors?: { message: string }[] };
  if (!response.ok || body.success === false) {
    throw new Error(body.errors?.map((e) => e.message).join("; ") || `HTTP ${response.status}`);
  }
  return body;
}

async function pageViews(since: Date): Promise<Signals["views"]> {
  const account = accountId();
  if (!process.env["CF_API_TOKEN"]) {
    return { available: false, reason: "set CF_API_TOKEN (Cloudflare API token with Account Analytics: Read)" };
  }
  if (!account) return { available: false, reason: "set CF_ACCOUNT_ID" };
  try {
    const query = `query ($account: string!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
      viewer { accounts(filter: { accountTag: $account }) {
        rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 5000, orderBy: [count_DESC]) {
          count
          dimensions { requestPath }
        }
      } }
    }`;
    const data = (await cloudflare("/graphql", {
      method: "POST",
      body: JSON.stringify({
        query,
        variables: {
          account,
          filter: { requestHost_in: SITE_HOSTS, datetime_geq: since.toISOString(), datetime_leq: new Date().toISOString() },
        },
      }),
    })) as {
      data?: { viewer: { accounts: { rumPageloadEventsAdaptiveGroups: { count: number; dimensions: { requestPath: string } }[] }[] } };
      errors?: { message: string }[] | null;
    };
    if (data.errors?.length) throw new Error(data.errors.map((e) => e.message).join("; "));
    const groups = data.data?.viewer.accounts[0]?.rumPageloadEventsAdaptiveGroups ?? [];
    const count = (prefix: string) =>
      groups.filter((g) => g.dimensions.requestPath.startsWith(prefix)).reduce((a, g) => a + g.count, 0);
    return {
      available: true,
      total: groups.reduce((a, g) => a + g.count, 0),
      changePages: count("/changes/"),
      apiPages: count("/apis/"),
      top: groups.slice(0, 10).map((g) => ({ path: g.dimensions.requestPath, count: g.count })),
    };
  } catch (err) {
    return { available: false, reason: `Cloudflare API: ${(err as Error).message}` };
  }
}

/** Re-read every logged fix PR's state from GitHub, then count. */
async function refreshFixPrs(): Promise<Signals["fixPrs"]> {
  const prs = await prisma.fixPr.findMany({ include: { repo: { select: { fullName: true } } } });
  let refreshFailures = 0;
  for (const pr of prs) {
    if (!pr.prNumber || pr.state === "MERGED" || pr.state === "CLOSED") continue;
    try {
      const response = await fetch(`https://api.github.com/repos/${pr.repo.fullName}/pulls/${pr.prNumber}`, {
        signal: AbortSignal.timeout(15_000),
        headers: {
          accept: "application/vnd.github+json",
          ...(config.githubToken ? { authorization: `Bearer ${config.githubToken}` } : {}),
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const github = (await response.json()) as { state: string; merged_at: string | null };
      const state = github.merged_at ? "MERGED" : github.state === "closed" ? "CLOSED" : "OPENED";
      if (state !== pr.state) {
        await prisma.fixPr.update({
          where: { id: pr.id },
          data: { state, mergedAt: github.merged_at ? new Date(github.merged_at) : null },
        });
        pr.state = state;
      }
    } catch (err) {
      refreshFailures++;
      log.warn(`fix PR ${pr.repo.fullName}#${pr.prNumber}: ${(err as Error).message}`);
    }
  }
  const count = (state: string) => prs.filter((pr) => pr.state === state).length;
  return {
    opened: prs.filter((pr) => pr.state !== "DRAFTED").length,
    merged: count("MERGED"),
    closed: count("CLOSED"),
    open: count("OPENED"),
    refreshFailures,
  };
}
