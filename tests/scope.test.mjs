import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { expect } from "./expect.mjs";
import { clientMatches, prCreateTarget } from "../skills/release/scripts/lib/scope.mjs";

describe("clientMatches", () => {
  it("ignores case, accents and surrounding space", () => {
    expect(clientMatches("Acme Hoteis", "  acme HOTÉIS ")).toBe(true);
    expect(clientMatches("Acme Hotéis", "acme hoteis")).toBe(true);
  });

  it("does not match a longer name", () => {
    expect(clientMatches("Acme Hoteis Group", "Acme Hoteis")).toBe(false);
  });
});

describe("prCreateTarget", () => {
  it("reads the flags after gh pr create, not after an earlier gh … create", () => {
    expect(prCreateTarget("gh x create --head wrong gh pr create --head feat/z")).toMatchObject({
      head: "feat/z",
    });
  });

  it("follows a cd guarded by ||, but not the fallback after it", () => {
    expect(prCreateTarget("cd /wt || exit 1 && gh pr create")).toEqual({ dir: "/wt" });
    expect(prCreateTarget("cd /wt || cd /other && gh pr create")).toEqual({ dir: "/wt" });
  });

  it("follows a leading cd and the --head branch", () => {
    expect(
      prCreateTarget(
        "cd ../frenti-spaces-spool && gh pr create --base main --head fix/cli-spool-replay --title x",
      ),
    ).toEqual({
      dir: "../frenti-spaces-spool",
      head: "fix/cli-spool-replay",
    });
    expect(prCreateTarget(`cd "/a b/c"; gh pr create -H 'feat/x'`)).toEqual({
      dir: "/a b/c",
      head: "feat/x",
    });
    expect(prCreateTarget("gh pr create --head=piclez:feat/y")).toEqual({ head: "feat/y" });
  });

  it("leaves a plain gh pr create to the session's checkout", () => {
    expect(prCreateTarget("gh pr create --fill")).toEqual({});
  });

  it("ignores a --head that belongs to a later command", () => {
    expect(prCreateTarget("gh pr create --fill && git log --head")).toEqual({});
    expect(prCreateTarget("gh pr create --fill && git log --head foo")).toEqual({});
  });

  it("does not read a flag out of a quoted title or body", () => {
    expect(prCreateTarget(`gh pr create --title "drop -H flag" --body 'use --head main'`)).toEqual(
      {},
    );
  });

  it("follows chained, newline-separated and home-relative cds", () => {
    expect(prCreateTarget("cd /a && git push && cd b && gh pr create")).toEqual({ dir: "/a/b" });
    expect(prCreateTarget("cd /a\ngh pr create")).toEqual({ dir: "/a" });
    expect(prCreateTarget("cd ~/w/shop && gh pr create")).toEqual({
      dir: join(homedir(), "w/shop"),
    });
  });

  it("takes the repo from --repo/-R", () => {
    expect(prCreateTarget("gh pr create -R github.com/acme/app --head x")).toEqual({
      head: "x",
      repo: "acme/app",
    });
    expect(prCreateTarget("gh pr create --repo=acme/app")).toEqual({ repo: "acme/app" });
  });
});
