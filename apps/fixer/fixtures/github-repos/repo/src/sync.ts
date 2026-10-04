import { Octokit } from "@octokit/rest";
import * as github from "@actions/github";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function repoInfo(owner: string, repo: string) {
  return octokit.rest.repos.get({ owner, repo }); // driftwatch-expect: sdk
}

export async function viaRoute(owner: string, repo: string) {
  return octokit.request("GET /repos/{owner}/{repo}", { owner, repo }); // driftwatch-expect: sdk
}

export async function inAnAction() {
  const kit = github.getOctokit(process.env.GITHUB_TOKEN!);
  return kit.rest.repos.get({ owner: "o", repo: "r" }); // driftwatch-expect: sdk
}

export async function raw(owner: string, repo: string) {
  return fetch(`https://api.github.com/repos/${owner}/${repo}`); // driftwatch-expect: http
}

// Not affected: other operations on the same API.
export async function fileIssue(owner: string, repo: string) {
  return octokit.rest.issues.create({ owner, repo, title: "x" });
}
export async function rename(owner: string, repo: string, name: string) {
  return octokit.rest.repos.update({ owner, repo, name });
}
