#!/usr/bin/env node
import { Command } from "commander";

import { disconnect } from "./db.js";
import { log } from "./log.js";
import { backfill } from "./commands/backfill.js";
import { diff } from "./commands/diff.js";
import { discover } from "./commands/discover.js";
import { preview } from "./commands/preview.js";
import { refingerprint } from "./commands/refingerprint.js";
import { report } from "./commands/report.js";
import { review } from "./commands/review.js";
import { poll } from "./commands/poll.js";
import { seed } from "./commands/seed.js";
import { signals } from "./commands/signals.js";
import { logPr } from "./commands/pr.js";
import { share } from "./commands/share.js";
import { status } from "./commands/status.js";
import { stories } from "./commands/stories.js";
import { verify } from "./commands/verify.js";

const program = new Command();

program
  .name("driftwatch")
  .description("Acquisition and normalization pipeline (stages 1-2)")
  .version("0.1.0");

program
  .command("seed")
  .description("Upsert registry sources. Clone repos for A; record hosted URLs for B")
  .action(seed);

program
  .command("discover")
  .argument("<target>", "provider slug, or a candidate's owner/repo or hosted URL")
  .option("-n, --limit <count>", "max files to list", "40")
  .description("List spec-shaped files in a repo, or confirm a hosted URL")
  .action((provider: string, opts: { limit: string }) =>
    discover(provider, Number(opts.limit)),
  );

program
  .command("backfill")
  .argument("[target]", 'provider slug or "slug/key"; omit for all')
  .option("-n, --limit <count>", "max commits per source")
  .option("-s, --since <date>", "only commits on or after this ISO date")
  .description("Walk git history (or fetch a hosted URL) and ingest distinct versions")
  .action((target: string | undefined, opts: { limit?: string; since?: string }) =>
    backfill({
      target,
      limit: opts.limit ? Number(opts.limit) : undefined,
      since: opts.since ? new Date(opts.since) : undefined,
    }),
  );

program
  .command("poll")
  .argument("[target]", 'provider slug or "slug/key"; omit for all')
  .description("Fetch current head and ingest if the normalized surface changed")
  .action((target: string | undefined) => poll(target));

program
  .command("diff")
  .argument("[target]", 'provider slug or "slug/key"; omit for all')
  .option("-n, --limit <count>", "only the most recent N pairs per source")
  .description("Diff every stored snapshot pair and persist typed changes")
  .action((target: string | undefined, opts: { limit?: string }) =>
    diff(target, opts.limit ? Number(opts.limit) : undefined),
  );

program
  .command("preview")
  .argument("<target>", 'provider slug or "slug/key"')
  .option("-n, --pairs <count>", "how many consecutive revision pairs", "5")
  .option("-f, --full", "list every change instead of grouping by rule")
  .option("--min <severity>", "lowest severity to show", "BEHAVIORAL")
  .description("Diff real revisions straight from git and print them — no database")
  .action((target: string, opts: { pairs: string; full?: boolean; min: string }) =>
    preview(target, {
      pairs: Number(opts.pairs),
      full: opts.full === true,
      min: opts.min.toUpperCase() as never,
    }),
  );

program
  .command("verify")
  .argument("[provider]", "provider slug; omit for all")
  .description("Resolve paths or hosted URLs, normalize HEAD, check hash stability — no database")
  .action((provider: string | undefined) => verify(provider));

program
  .command("review")
  .argument("[target]", 'provider slug or "slug/key"; omit for all')
  .option("-s, --severity <severity>", "only this severity")
  .option("-n, --limit <count>", "facts to list", "40")
  .option("--publish", "actually publish what is listed (read-only without it)")
  .option("--all", "include low-confidence and cosmetic changes (never publish these)")
  .option("--auto", "apply the auto-publish policy: publish what it allows, hold the rest")
  .option(
    "--reject <text>",
    "mark pending stories whose rule or location contains <text> as reviewed and not published",
  )
  .description("The review gate: inspect pending changes, then publish or reject them")
  .action(
    (
      target: string | undefined,
      opts: {
        severity?: string;
        limit: string;
        publish?: boolean;
        all?: boolean;
        reject?: string;
        auto?: boolean;
      },
    ) =>
      review(target, {
        severity: opts.severity?.toUpperCase() as never,
        limit: Number(opts.limit),
        publish: opts.publish === true,
        all: opts.all === true,
        reject: opts.reject,
        auto: opts.auto === true,
      }),
  );

program
  .command("status")
  .description("Show what is in the database")
  .action(status);

program
  .command("report")
  .option("--out <file>", "write the body here and the title to <file>.title; remove both when all clear")
  .description("What needs a person: stories to review and sources not fetching")
  .action((opts: { out?: string }) => report(opts));

program
  .command("share")
  .option("--generate", "draft posts for published breaking changes from the last 14 days that have none")
  .option("--posted <storyId>", "mark a draft as posted")
  .option("--skip <storyId>", "mark a draft as not worth posting")
  .option("-n, --limit <count>", "drafts to show", "10")
  .option("--out <file>", "write the drafts to a markdown file instead")
  .description("The share kit: draft X and HN/Reddit posts for breaking changes. Never posts.")
  .action((opts: { generate?: boolean; posted?: string; skip?: string; limit: string; out?: string }) =>
    share({ ...opts, generate: opts.generate === true, limit: Number(opts.limit) }),
  );

program
  .command("signals")
  .option("-d, --days <count>", "window for views, feed fetches and recent signups", "7")
  .description("The week-6 numbers: page views, feed fetches, waitlist, fix PRs, pipeline health")
  .action((opts: { days: string }) => signals({ days: Number(opts.days) }));

program
  .command("pr")
  .argument("<action>", 'only "log" for now')
  .argument("<url>", "the fix PR on GitHub, https://github.com/<owner>/<repo>/pull/<n>")
  .requiredOption("--change <storyId>", "the change it fixes (the id in driftwatch.et/changes/<id>)")
  .description("Log a fix PR opened by hand, so signals can follow it to merged or closed")
  .action((action: string, url: string, opts: { change: string }) => {
    if (action !== "log") throw new Error(`unknown action "${action}"; use: pnpm w pr log <url> --change <id>`);
    return logPr(url, opts.change);
  });

program
  .command("stories")
  .description("Give every fact at the current ruleset its permanent story id (idempotent)")
  .action(stories);

program
  .command("refingerprint")
  .description("One-off: rewrite stored endpoint-rule fingerprints to the 1.3.0 formula")
  .action(refingerprint);

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    log.error((err as Error).message);
    process.exitCode = 1;
  } finally {
    await disconnect();
  }
}

void main();
