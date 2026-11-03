// Lines a PR adds, split into what a person writes (code, tests, docs) and what a tool
// writes. Generated files are listed but never counted toward an estimate: a 1,545-line
// openapi.json once turned a 6 h change into a 40 h entry.

import { execFileSync } from "node:child_process";

const GENERATED = [
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/,
  /(^|\/)openapi[^/]*\.(json|ya?ml)$/i,
  /\.snap$/,
  /\.min\.(js|css)$/,
  /(^|\/)(dist|build|generated|__generated__|vendor)\//,
  /(^|\/)next-env\.d\.ts$/,
  /(^|\/)migrations\/.+\.sql$/,
  /\.(png|jpe?g|gif|webp|svg|ico|pdf|woff2?)$/i,
];
const TESTS = [
  /(^|\/)(tests?|__tests__|e2e|spec)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.(go|py|rb)$/,
];
const DOCS = [/\.(md|mdx|rst|txt|adoc)$/i, /(^|\/)docs\//];

export function kindOf(path) {
  if (GENERATED.some((r) => r.test(path))) return "generated";
  if (TESTS.some((r) => r.test(path))) return "tests";
  if (DOCS.some((r) => r.test(path))) return "docs";
  return "code";
}

/** files: [{ path, additions }] → totals per kind plus the files, biggest first. */
export function splitLines(files) {
  const lines = { code: 0, tests: 0, docs: 0, generated: 0 };
  const listed = files
    .map((f) => ({ path: f.path, additions: f.additions, kind: kindOf(f.path) }))
    .sort((a, b) => b.additions - a.additions);
  for (const f of listed) lines[f.kind] += f.additions;
  return { lines, files: listed };
}

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8" }).trim();

/** The PR's files from GitHub, or null when gh cannot see the PR. */
export function prFiles(repo, pr) {
  try {
    const out = run("gh", ["pr", "view", String(pr), "--repo", repo, "--json", "files"]);
    return JSON.parse(out).files.map((f) => ({ path: f.path, additions: f.additions }));
  } catch {
    return null;
  }
}

/** Before a PR exists: the branch against its merge base with `base`. */
export function branchFiles(branch, base, cwd) {
  const out = run("git", ["diff", "--numstat", `${base}...${branch}`], cwd);
  return out
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const [add, , path] = row.split("\t");
      return { path, additions: add === "-" ? 0 : Number(add) };
    });
}
