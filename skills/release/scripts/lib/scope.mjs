// Where a `gh pr create` really runs, so the gate checks the right repo and branch,
// and client-name matching for the client files.

import { homedir } from "node:os";
import { join } from "node:path";

const fold = (s) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

/** True when `ref` names the client, ignoring accents and case ("Acme Hotéis" = "acme hoteis"). */
export const clientMatches = (name, ref) => fold(ref) === fold(name);

// A shell-ish lexer: enough quoting to keep `--title "drop -H flag"` one word and
// to split on `&&`, `||`, `;`, `|`, `&` and newlines outside quotes. It does not
// expand variables or command substitutions.
function segments(command) {
  const out = [];
  let words = [];
  let word = "";
  let inWord = false;
  let quote = null;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endSegment = (sep) => {
    endWord();
    if (words.length || sep) out.push({ words, sep });
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < command.length) word += command[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === "\\" && i + 1 < command.length) {
      word += command[++i];
      inWord = true;
    } else if (c === " " || c === "\t") {
      endWord();
    } else if (c === "\n" || c === ";") {
      endSegment(c);
    } else if (c === "&" || c === "|") {
      const op = command[i + 1] === c ? c + c : c;
      i += op.length - 1;
      endSegment(op);
    } else {
      word += c;
      inWord = true;
    }
  }
  endSegment("");
  return out;
}

const expandHome = (p) =>
  p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;

const flagValue = (words, long, short) => {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if ((w === long || w === short) && i + 1 < words.length) return words[i + 1];
    if (w.startsWith(`${long}=`)) return w.slice(long.length + 1);
  }
  return undefined;
};

/**
 * Where a `gh pr create` command really runs. The hook event's cwd is the
 * session's checkout, so a `cd ../worktree && gh pr create` must be checked
 * against the worktree. Every `cd` chained before the `gh pr create` by `&&`,
 * `||`, `;` or a newline moves the directory, except one that only runs after a
 * failed command (`cd a || cd b`); `--head`/`-H` names the branch outright
 * (an `owner:branch` head keeps only the branch); `--repo`/`-R` names the repo
 * (`[HOST/]OWNER/REPO` keeps `OWNER/REPO`).
 */
export function prCreateTarget(command) {
  const segs = segments(command);
  const at = segs.findIndex(({ words }) =>
    words.some((w, i) => w === "gh" && words[i + 1] === "pr" && words[i + 2] === "create"),
  );
  if (at < 0) return {};

  let dir;
  for (const [i, { words, sep }] of segs.slice(0, at).entries()) {
    if (words[0] !== "cd" || words.length > 2 || !["&&", "||", ";", "\n"].includes(sep)) continue;
    // `cd a || <fallback>`: the fallback runs only when cd failed, and then gh
    // does not run either, so a cd there never sets the directory.
    if (segs[i - 1]?.sep === "||") continue;
    const to = expandHome(words[1] ?? "~");
    if (to === "-") continue;
    dir = to.startsWith("/") || dir === undefined ? to : join(dir, to);
  }

  const words = segs[at].words;
  const args = words.slice(
    words.findIndex((w, i) => w === "gh" && words[i + 1] === "pr" && words[i + 2] === "create") + 3,
  );
  const head = flagValue(args, "--head", "-H")?.replace(/^[^:]+:/, "");
  const repo = flagValue(args, "--repo", "-R")?.split("/").slice(-2).join("/");
  return {
    ...(dir ? { dir } : {}),
    ...(head ? { head } : {}),
    ...(repo && repo.includes("/") ? { repo } : {}),
  };
}
