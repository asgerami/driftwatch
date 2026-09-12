#!/usr/bin/env node
import { Command } from "commander";

import { disconnect } from "./db.js";
import { log } from "./log.js";
import { backfill } from "./commands/backfill.js";
import { diff } from "./commands/diff.js";
import { discover } from "./commands/discover.js";
import { preview } from "./commands/preview.js";
import { poll } from "./commands/poll.js";
import { seed } from "./commands/seed.js";
import { status } from "./commands/status.js";
import { verify } from "./commands/verify.js";

const program = new Command();

program
  .name("driftwatch")
  .description("Acquisition and normalization pipeline (stages 1-2)")
  .version("0.1.0");

program
  .command("seed")
  .description("Clone registry repos, resolve spec paths, upsert providers and sources")
  .action(seed);

program
  .command("discover")
  .argument("<provider>", "provider slug, e.g. stripe")
  .option("-n, --limit <count>", "max files to list", "40")
  .description("List files in a provider's repo that look like OpenAPI documents")
  .action((provider: string, opts: { limit: string }) =>
    discover(provider, Number(opts.limit)),
  );

program
  .command("backfill")
  .argument("[target]", 'provider slug or "slug/key"; omit for all')
  .option("-n, --limit <count>", "max commits per source")
  .option("-s, --since <date>", "only commits on or after this ISO date")
  .description("Walk git history and ingest every distinct version of each spec")
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
  .description("Resolve paths, walk history and normalize HEAD — no database needed")
  .action((provider: string | undefined) => verify(provider));

program
  .command("status")
  .description("Show what is in the database")
  .action(status);

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
