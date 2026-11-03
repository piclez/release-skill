import { execFileSync } from "node:child_process";

const gh = (args) => execFileSync("gh", args, { encoding: "utf8" }).trim();

export const currentBranch = () =>
  execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim();

/** The branch's PR in any state, or null before `gh pr create`. */
export function pullRequestFor(branch) {
  const rows = JSON.parse(
    gh([
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--limit",
      "1",
      "--json",
      "number,url,title,state,createdAt,mergedAt",
    ]),
  );
  return rows[0] ?? null;
}

/**
 * The number `gh pr create` will get: issues and PRs share one sequence, so it
 * is the newest of either plus one. `release.mjs check` corrects it if
 * another one lands first.
 */
export function nextPullNumber() {
  const newest = gh([
    "api",
    "repos/{owner}/{repo}/issues?state=all&per_page=1&sort=created&direction=desc",
    "--jq",
    ".[0].number // 0",
  ]);
  return Number(newest) + 1;
}

export const repoUrl = () => gh(["repo", "view", "--json", "url", "--jq", ".url"]);

/** A calendar day in the client's time zone, so an evening merge lands on the right date. */
export const dayIn = (timeZone, at) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(at));

export function prStatus(pr) {
  return pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : "open";
}
