#!/usr/bin/env node
// Client delivery log: one entry per PR, with an approved hours estimate and the Claude
// tokens spent on its branch. See skills/release/SKILL.md for when each command runs.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  currentBranch,
  dayIn,
  nextPullNumber,
  prStatus,
  pullRequestFor,
  repoUrl,
} from "./lib/gh.mjs";
import { branchFiles, prFiles, splitLines } from "./lib/lines.mjs";
import { renderReleasesPage } from "./lib/page.mjs";
import { prCreateTarget } from "./lib/scope.mjs";
import {
  clientForRepo,
  entryFor,
  findClient,
  loadClients,
  productFor,
  releasesDir,
  repoName,
  saveClient,
  slugify,
  upsertEntry,
} from "./lib/store.mjs";
import { measureClaudeUsage } from "./lib/usage.mjs";

const DEFAULT_BRANCHES = ["main", "master", "develop"];

const fail = (message) => {
  console.error(`release: ${message}`);
  process.exit(1);
};

const when = (value, name) => {
  if (!value) return undefined;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) fail(`--${name} needs an ISO date-time, got "${value}".`);
  return at;
};

const fmt = (n) => n.toLocaleString("en");

function clientOrFail(ref) {
  if (ref) return findClient(ref) ?? fail(`no client file matches "${ref}" in ${releasesDir()}.`);
  const repo = repoName();
  return (
    clientForRepo(repo) ??
    fail(`no client lists ${repo}. Run: release.mjs init --client "<name>" --repo ${repo} --product "<name>"`)
  );
}

/**
 * Tokens on the branch, bounded by the merge when the PR is merged: a branch that keeps
 * being used after its merge must not grow an entry the client already saw.
 */
function measureTokens(branch, pr, opts) {
  const until = when(opts.until, "until") ?? (pr?.mergedAt ? new Date(pr.mergedAt) : undefined);
  const usage = measureClaudeUsage(opts["measure-branch"] ?? branch, pr?.number ?? null, undefined, {
    since: when(opts.since, "since"),
    until,
  });
  return usage ? { tokens: usage.tokens, sessions: usage.sessions } : null;
}

const WINDOW = {
  "measure-branch": { type: "string" },
  since: { type: "string" },
  until: { type: "string" },
};

const commands = {
  init: {
    help: 'init --client "<name>" --repo <owner/repo> --product "<name>" [--tz <iana>] [--artifact <slug>]',
    options: {
      client: { type: "string" },
      repo: { type: "string" },
      product: { type: "string" },
      tz: { type: "string" },
      artifact: { type: "string" },
    },
    run(opts) {
      if (!opts.client) fail("init needs --client.");
      const repo = opts.repo ?? repoName();
      const existing = findClient(opts.client);
      const client = existing ?? {
        file: join(releasesDir(), `${slugify(opts.client)}.json`),
        data: { client: opts.client, tz: "UTC", artifact: null, repos: {}, entries: [] },
      };
      const other = clientForRepo(repo);
      if (other && other.file !== client.file) fail(`${repo} already belongs to ${other.data.client}.`);
      client.data.repos[repo] = opts.product ?? client.data.repos[repo] ?? repo.split("/")[1];
      if (opts.tz) client.data.tz = opts.tz;
      if (opts.artifact) client.data.artifact = { slug: opts.artifact };
      saveClient(client);
      console.log(`${existing ? "Updated" : "Created"} ${client.file}: ${repo} → ${client.data.repos[repo]}`);
    },
  },

  measure: {
    help: "measure [--branch <b>] [--base main] [--json] [--measure-branch <b>] [--since <iso>] [--until <iso>]",
    options: { branch: { type: "string" }, base: { type: "string" }, json: { type: "boolean" }, ...WINDOW },
    run(opts) {
      const branch = opts.branch ?? currentBranch();
      const repo = repoName();
      const pr = pullRequestFor(branch);
      const files = (pr && prFiles(repo, pr.number)) ?? branchFiles(branch, opts.base ?? "main");
      const split = splitLines(files);
      const measured = measureTokens(branch, pr, opts);
      const result = { repo, branch, pr: pr?.number ?? null, ...split, ...(measured ?? { tokens: null, sessions: 0 }) };
      if (opts.json) return console.log(JSON.stringify(result, null, 2));
      const { lines } = split;
      console.log(`${repo} ${branch}${pr ? ` (PR #${pr.number}, ${prStatus(pr)})` : " (no PR yet)"}`);
      console.log(`  code ${fmt(lines.code)} · tests ${fmt(lines.tests)} · docs ${fmt(lines.docs)} · generated ${fmt(lines.generated)} (not counted)`);
      for (const f of split.files.slice(0, 15)) console.log(`  ${String(f.additions).padStart(6)}  ${f.kind.padEnd(9)} ${f.path}`);
      if (split.files.length > 15) console.log(`  … ${split.files.length - 15} more files`);
      console.log(measured ? `  tokens ${fmt(measured.tokens.total)} in ${measured.sessions} session(s)` : "  tokens: no session logs for this branch");
    },
  },

  add: {
    help: 'add --estimate <h> --title-pt "…" --title-en "…" --summary-pt "…" --summary-en "…" [--breakdown "…"] [--branch <b>]',
    options: {
      branch: { type: "string" },
      estimate: { type: "string" },
      breakdown: { type: "string" },
      "title-pt": { type: "string" },
      "title-en": { type: "string" },
      "summary-pt": { type: "string" },
      "summary-en": { type: "string" },
      ...WINDOW,
    },
    run(opts) {
      const branch = opts.branch ?? currentBranch();
      if (!branch || DEFAULT_BRANCHES.includes(branch)) fail(`add runs on a work branch, not "${branch || "detached HEAD"}".`);
      const repo = repoName();
      const client = clientOrFail();
      const pr = pullRequestFor(branch);
      const existing = entryFor(client, repo, { branch, pr: pr?.number });
      const prNumber = pr?.number ?? existing?.pr ?? nextPullNumber();
      const pick = (name, kept) =>
        opts[name]?.trim() || kept || fail(`a new entry needs --${name}. See: release.mjs help add`);
      const estimate = opts.estimate ? Number(opts.estimate) : existing?.estimateHours;
      if (!(estimate > 0)) fail("a new entry needs --estimate <hours> (a positive number).");
      const files = (pr && prFiles(repo, pr.number)) ?? branchFiles(branch, "main");
      const measured = measureTokens(branch, pr, opts);
      const entry = {
        repo,
        product: productFor(client, repo),
        branch,
        pr: prNumber,
        url: pr?.url ?? existing?.url ?? `${repoUrl()}/pull/${prNumber}`,
        status: pr ? prStatus(pr) : "open",
        date: pr ? dayIn(client.data.tz, pr.mergedAt ?? pr.createdAt) : (existing?.date ?? dayIn(client.data.tz, new Date())),
        title: { pt: pick("title-pt", existing?.title.pt), en: pick("title-en", existing?.title.en) },
        summary: { pt: pick("summary-pt", existing?.summary.pt), en: pick("summary-en", existing?.summary.en) },
        estimateHours: estimate,
        estimateBreakdown: opts.breakdown ?? existing?.estimateBreakdown ?? null,
        lines: splitLines(files).lines,
        // A failed measurement keeps the stored count rather than erasing it.
        tokens: measured?.tokens ?? existing?.tokens ?? null,
        sessions: measured?.sessions ?? existing?.sessions ?? 0,
      };
      const action = upsertEntry(client, entry, existing);
      saveClient(client);
      console.log(
        `${action === "added" ? "Added" : "Updated"} #${prNumber}${pr ? "" : " (predicted; run check after gh pr create)"} ${branch} → ${client.data.client}: ` +
          `${estimate} h, ${entry.tokens ? `${fmt(entry.tokens.total)} tokens` : "tokens not measured"}`,
      );
    },
  },

  check: {
    help: "check [--branch <b>] [--measure-branch <b>] [--since <iso>] [--until <iso>]",
    options: { branch: { type: "string" }, ...WINDOW },
    run(opts) {
      const branch = opts.branch ?? currentBranch();
      const repo = repoName();
      const client = clientOrFail();
      const pr = pullRequestFor(branch) ?? fail(`${branch} has no PR yet.`);
      const entry =
        entryFor(client, repo, { branch, pr: pr.number }) ?? fail(`no entry for ${branch}. Run add first.`);
      const measured = measureTokens(branch, pr, opts);
      const fresh = {
        pr: pr.number,
        url: pr.url,
        status: prStatus(pr),
        date: dayIn(client.data.tz, pr.mergedAt ?? pr.createdAt),
        tokens: measured?.tokens ?? entry.tokens,
        sessions: measured?.sessions ?? entry.sessions,
      };
      const changed = Object.keys(fresh).filter((k) => JSON.stringify(fresh[k]) !== JSON.stringify(entry[k]));
      if (!changed.length) return console.log(`#${pr.number} ${branch}: entry matches the PR.`);
      upsertEntry(client, { ...entry, ...fresh }, entry);
      saveClient(client);
      console.log(`#${pr.number} ${branch}: updated ${changed.join(", ")}.`);
    },
  },

  html: {
    help: 'html [--client "<name>"] [--out <file>]',
    options: { client: { type: "string" }, out: { type: "string" } },
    run(opts) {
      const client = clientOrFail(opts.client);
      const entries = client.data.entries.map((e) => ({
        ...e,
        measured: e.tokens ? { activeHours: 0, tokens: e.tokens, sessions: e.sessions ?? 0 } : null,
      }));
      const out = resolve(opts.out ?? join(releasesDir(), `${client.slug}.html`));
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, renderReleasesPage(entries, new Date(), client.data.client, client.data.tz));
      console.log(out);
      console.log(client.data.artifact?.slug ? `artifact: ${client.data.artifact.slug}` : "artifact: none yet");
    },
  },

  // PreToolUse hook body. Exit 2 blocks the tool call and shows stderr to Claude.
  require: {
    help: "require   (hook: reads the PreToolUse event on stdin)",
    options: {},
    async run() {
      let input = "";
      for await (const chunk of process.stdin) input += chunk;
      let event;
      try {
        event = JSON.parse(input);
      } catch {
        return;
      }
      const command = event.tool_input?.command ?? "";
      if (!/\bgh\s+pr\s+create\b/.test(command)) return;
      // Contexto's lane runner sets this for its headless workers, which can't ask for the hours.
      // The entry is added after the PR opens.
      if (process.env.CONTEXTO_LANE === "1") return;
      const clients = loadClients();
      if (!clients.length) return;
      const target = prCreateTarget(command);
      let repo, branch;
      try {
        const cwd = resolve(event.cwd ?? process.cwd(), target.dir ?? ".");
        repo = target.repo ?? repoName(cwd);
        process.chdir(cwd);
        branch = target.head ?? currentBranch();
      } catch (err) {
        console.error(`release require: skipped (${err.message})`);
        return;
      }
      // Repos no client lists (personal projects, other work) are never blocked.
      const client = clientForRepo(repo, clients);
      if (!client || entryFor(client, repo, { branch })) return;
      console.error(
        [
          `No delivery entry for ${branch} (${client.data.client}). Every PR for this client gets one before it opens.`,
          `Use the release skill: measure, propose the texts and the hours with a breakdown, wait for the user's yes, then add.`,
        ].join("\n"),
      );
      process.exit(2);
    },
  },

  import: {
    help: 'import <file.json> --client "<name>"   (entries in this format, or frenti /api/deliveries rows)',
    options: { client: { type: "string" } },
    positionals: true,
    run(opts, [file]) {
      if (!file) fail("import needs a file.");
      const client = clientOrFail(opts.client);
      const raw = JSON.parse(readFileSync(resolve(file), "utf8"));
      const rows = Array.isArray(raw) ? raw : (raw.deliveries ?? raw.entries ?? []);
      for (const r of rows) {
        const frenti = "prNumber" in r;
        const total = frenti ? r.tokens : r.tokens?.total;
        upsertEntry(client, {
          repo: r.repo,
          product: r.product ?? r.project?.name ?? productFor(client, r.repo),
          branch: r.branch,
          pr: frenti ? r.prNumber : r.pr,
          url: frenti ? r.prUrl : r.url,
          status: r.status,
          date: frenti ? r.deliveredOn : r.date,
          title: r.title,
          summary: r.summary,
          estimateHours: r.estimateHours,
          estimateBreakdown: r.estimateBreakdown ?? null,
          lines: r.lines ?? null,
          tokens:
            total == null
              ? null
              : frenti
                ? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...r.tokenBreakdown, total }
                : r.tokens,
          sessions: r.sessions ?? 0,
        });
        if (r.repo && !productFor(client, r.repo) && (r.product ?? r.project?.name))
          client.data.repos[r.repo] = r.product ?? r.project.name;
      }
      saveClient(client);
      console.log(`Imported ${rows.length} entr${rows.length === 1 ? "y" : "ies"} into ${client.file}`);
    },
  },

  // Reports only: never changes an entry.
  audit: {
    help: 'audit [--client "<name>"]',
    options: { client: { type: "string" } },
    run(opts) {
      const client = clientOrFail(opts.client);
      const rows = client.data.entries.map((e) => {
        const lines = e.lines ?? (prFiles(e.repo, e.pr) ? splitLines(prFiles(e.repo, e.pr)).lines : null);
        const counted = lines ? lines.code + lines.tests + lines.docs : null;
        return { e, lines, counted, perHour: counted ? Math.round(counted / e.estimateHours) : null };
      });
      rows.sort((a, b) => (a.perHour ?? Infinity) - (b.perHour ?? Infinity));
      console.log(`${client.data.client}: lowest lines per estimated hour first (generated files excluded)\n`);
      console.log("hours  code  tests  docs  generated  lines/h  PR");
      for (const { e, lines, perHour } of rows) {
        const l = lines ?? { code: "?", tests: "?", docs: "?", generated: "?" };
        console.log(
          `${String(e.estimateHours).padStart(5)} ${String(l.code).padStart(5)} ${String(l.tests).padStart(6)} ${String(l.docs).padStart(5)} ${String(l.generated).padStart(10)} ${String(perHour ?? "?").padStart(8)}  ${e.product ? `${e.product} ` : ""}#${e.pr} ${e.title.pt}`,
        );
      }
    },
  },
};

const [name, ...rest] = process.argv.slice(2);
const command = commands[name];
if (!command || name === "help") {
  const which = commands[rest[0]];
  console.log(which ? `release.mjs ${which.help}` : `release.mjs <command>\n\n${Object.values(commands).map((c) => `  ${c.help}`).join("\n")}`);
  process.exit(command || name === "help" ? 0 : 1);
}
const { values, positionals } = parseArgs({ args: rest, options: command.options, allowPositionals: !!command.positionals });
await command.run(values, positionals);
