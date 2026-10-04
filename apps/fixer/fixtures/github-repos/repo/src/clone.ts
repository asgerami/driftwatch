import { Octokit } from "@octokit/rest";

const octokit = new Octokit();

export async function cloneToken(owner: string, repo: string) {
  const { data } = await octokit.rest.repos.get({ owner, repo }); // driftwatch-expect: sdk
  if (data.private) {
    return data.temp_clone_token; // driftwatch-expect: field
  }
  return null;
}

export async function viaRoute(owner: string, repo: string) {
  return octokit
    .request("GET /repos/{owner}/{repo}", { owner, repo }) // driftwatch-expect: sdk
    .then((r) => r.data.temp_clone_token); // driftwatch-expect: field
}

export async function raw(owner: string, repo: string) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`); // driftwatch-expect: http
  if (!res.ok) throw new Error(String(res.status));
  const repoJson = await res.json();
  return repoJson["temp_clone_token"]; // driftwatch-expect: field
}

// Not affected: a field that did not change, and the same name on an
// operation the change does not touch.
export async function stars(owner: string, repo: string) {
  const { data } = await octokit.rest.repos.get({ owner, repo }); // driftwatch-expect: sdk
  return data.stargazers_count;
}
export async function issue(owner: string, repo: string) {
  const { data } = await octokit.rest.issues.get({ owner, repo, issue_number: 1 });
  return (data as { temp_clone_token?: string }).temp_clone_token;
}
