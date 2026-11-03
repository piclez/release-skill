import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { expect } from "./expect.mjs";
import { kindOf, splitLines } from "../skills/release/scripts/lib/lines.mjs";

const CLI = new URL("../skills/release/scripts/release.mjs", import.meta.url).pathname;

function gitRepo(origin) {
  const dir = mkdtempSync(join(tmpdir(), "release-repo-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir });
  git("init", "-q", "-b", "feat/x");
  git("remote", "add", "origin", origin);
  return dir;
}

function cli(args, { cwd, releases, input } = {}) {
  return spawnSync("node", [CLI, ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, RELEASES_DIR: releases },
  });
}

const hookEvent = (cwd, command) => JSON.stringify({ cwd, tool_input: { command } });

describe("lines", () => {
  it("never counts generated files", () => {
    expect(kindOf("docs/openapi.json")).toBe("generated");
    expect(kindOf("pnpm-lock.yaml")).toBe("generated");
    expect(kindOf("prisma/migrations/20261027000000_x/migration.sql")).toBe("generated");
    expect(kindOf("packages/domain/tests/integration/api-client.test.ts")).toBe("tests");
    expect(kindOf("src/a.spec.tsx")).toBe("tests");
    expect(kindOf("docs/decisions/D17.md")).toBe("docs");
    expect(kindOf("README.md")).toBe("docs");
    expect(kindOf("apps/web/src/lib/http/service-route.ts")).toBe("code");
  });

  it("totals per kind", () => {
    const { lines, files } = splitLines([
      { path: "docs/openapi.json", additions: 1545 },
      { path: "src/a.ts", additions: 100 },
      { path: "tests/a.test.ts", additions: 50 },
    ]);
    expect(lines).toEqual({ code: 100, tests: 50, docs: 0, generated: 1545 });
    expect(files[0].path).toBe("docs/openapi.json");
  });
});

describe("client files and the PR gate", () => {
  const releases = mkdtempSync(join(tmpdir(), "releases-"));
  const listed = gitRepo("git@github.com:Acme/shop.git");
  const unlisted = gitRepo("https://github.com/someone/personal.git");

  it("init creates the client file and refuses a repo another client owns", () => {
    const r = cli(["init", "--client", "Acme Hotéis", "--product", "Shop", "--tz", "America/Sao_Paulo"], { cwd: listed, releases });
    expect(r.status).toBe(0);
    const data = JSON.parse(readFileSync(join(releases, "acme-hoteis.json"), "utf8"));
    expect(data).toMatchObject({ client: "Acme Hotéis", tz: "America/Sao_Paulo", repos: { "Acme/shop": "Shop" } });
    expect(cli(["init", "--client", "Other"], { cwd: listed, releases }).status).toBe(1);
  });

  it("blocks gh pr create in a listed repo with no entry", () => {
    const r = cli(["require"], { releases, input: hookEvent(listed, 'gh pr create --title "x"') });
    expect(r.status).toBe(2);
    expect(/No delivery entry for feat\/x \(Acme Hotéis\)/.test(r.stderr)).toBe(true);
  });

  it("follows a cd before gh pr create", () => {
    const r = cli(["require"], { releases, input: hookEvent(unlisted, `cd ${listed} && gh pr create`) });
    expect(r.status).toBe(2);
  });

  it("lets unlisted repos and other commands through", () => {
    expect(cli(["require"], { releases, input: hookEvent(unlisted, "gh pr create") }).status).toBe(0);
    expect(cli(["require"], { releases, input: hookEvent(listed, "gh pr view 3") }).status).toBe(0);
    expect(cli(["require"], { releases, input: "not json" }).status).toBe(0);
  });

  it("imports frenti rows, keeps two PRs from one branch, and renders the page", () => {
    const row = (pr, status, title) => ({
      repo: "acme/shop",
      branch: "feat/x",
      prNumber: pr,
      prUrl: `https://github.com/Acme/shop/pull/${pr}`,
      deliveredOn: `2026-10-${20 + pr}`,
      status,
      title: { pt: title, en: title },
      summary: { pt: "Resumo", en: "Summary" },
      estimateHours: pr === 9 ? 6 : 2,
      tokens: 1000 * pr,
      tokenBreakdown: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
      project: { name: "Shop" },
    });
    const file = join(releases, "..", `export-${process.pid}.json`);
    writeFileSync(file, JSON.stringify({ deliveries: [row(5, "merged", "Primeiro PR"), row(9, "merged", "API do check-in")] }));
    expect(cli(["import", file, "--client", "acme hoteis"], { releases }).status).toBe(0);
    expect(existsSync(join(releases, "acme-hoteis.json.bak"))).toBe(true);
    const data = JSON.parse(readFileSync(join(releases, "acme-hoteis.json"), "utf8"));
    expect(data.entries.map((e) => e.pr)).toEqual([9, 5]);
    expect(data.entries[0].tokens).toEqual({ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 9000 });

    // Both PRs on feat/x are merged: a third PR from the reused branch needs its own entry.
    expect(cli(["require"], { releases, input: hookEvent(listed, "gh pr create") }).status).toBe(2);
    writeFileSync(file, JSON.stringify({ deliveries: [row(10, "open", "Terceiro PR")] }));
    expect(cli(["import", file, "--client", "acme hoteis"], { releases }).status).toBe(0);
    expect(cli(["require"], { releases, input: hookEvent(listed, "gh pr create") }).status).toBe(0);

    const out = join(releases, "page.html");
    expect(cli(["html", "--client", "Acme Hotéis", "--out", out], { releases }).status).toBe(0);
    const html = readFileSync(out, "utf8");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.split('<article class="entry"').length - 1).toBe(3);
    expect(html.includes("API do check-in")).toBe(true);
    expect(html.includes("6 h")).toBe(true);
  });
});
