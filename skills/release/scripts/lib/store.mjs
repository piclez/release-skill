// One JSON file per client in RELEASES_DIR (default ~/.claude/releases). Hours and token
// spend are agency data, so they live outside the client's repos; one file covers every
// repo the client has.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { clientMatches } from "./scope.mjs";

export const releasesDir = () => process.env.RELEASES_DIR || join(homedir(), ".claude", "releases");

export const slugify = (name) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function loadClients(dir = releasesDir()) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const file = join(dir, name);
      return { file, slug: name.slice(0, -5), data: JSON.parse(readFileSync(file, "utf8")) };
    });
}

/** The client by file slug or by name, ignoring accents and case. */
export const findClient = (ref, clients = loadClients()) =>
  clients.find((c) => c.slug === slugify(ref) || clientMatches(c.data.client, ref)) ?? null;

/** The client whose `repos` map lists `repo` ("owner/name", case-insensitive). */
export const clientForRepo = (repo, clients = loadClients()) =>
  clients.find((c) =>
    Object.keys(c.data.repos ?? {}).some((r) => r.toLowerCase() === repo.toLowerCase()),
  ) ?? null;

export const productFor = (client, repo) =>
  Object.entries(client.data.repos ?? {}).find(([r]) => r.toLowerCase() === repo.toLowerCase())?.[1];

const sameRepo = (a, b) => a.toLowerCase() === b.toLowerCase();

/**
 * The entry for a PR, else the open entry on the branch. Branches get reused for a second
 * PR, so a merged entry never answers for its branch: the new PR needs its own entry.
 */
export function entryFor(client, repo, { branch, pr } = {}) {
  const inRepo = client.data.entries.filter((e) => sameRepo(e.repo, repo));
  return (
    (pr != null && inRepo.find((e) => e.pr === pr)) ||
    (branch && inRepo.find((e) => e.branch === branch && e.status === "open")) ||
    null
  );
}

/**
 * Writes through a temp file and keeps the previous version as <slug>.json.bak: the file
 * is the only copy of the log, so a crash mid-write or a bad edit must be recoverable.
 */
export function saveClient(client) {
  mkdirSync(join(client.file, ".."), { recursive: true });
  if (existsSync(client.file)) copyFileSync(client.file, `${client.file}.bak`);
  const tmp = `${client.file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(client.data, null, 2)}\n`);
  renameSync(tmp, client.file);
}

/** Replaces `previous` (its PR number may have changed), else the same repo + PR, else adds. */
export function upsertEntry(client, entry, previous = null) {
  const entries = client.data.entries;
  const at = previous
    ? entries.indexOf(previous)
    : entries.findIndex((e) => sameRepo(e.repo, entry.repo) && e.pr === entry.pr);
  if (at < 0) entries.push(entry);
  else entries[at] = entry;
  entries.sort((a, b) => b.date.localeCompare(a.date) || b.pr - a.pr);
  return at < 0 ? "added" : "updated";
}

/** "owner/name" from the origin remote, without a network call (the hook runs on every Bash). */
export function repoName(cwd = process.cwd()) {
  const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" }).trim();
  const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`cannot read owner/repo from origin ${url}`);
  return m[1];
}
