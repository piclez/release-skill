import { describe, it } from "node:test";
import { expect } from "./expect.mjs";
import { releaseMonths, releasesByMonth, releaseTotals } from "../skills/release/scripts/lib/calendar.mjs";

const entry = (pr, date, hours, tokens) => ({
  pr,
  url: `https://example.test/pull/${pr}`,
  branch: `feat/${pr}`,
  date,
  status: "merged",
  title: { pt: `PR ${pr}`, en: `PR ${pr}` },
  summary: { pt: "", en: "" },
  estimateHours: hours,
  measured:
    tokens === null
      ? null
      : {
          activeHours: hours / 2,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: tokens },
          sessions: 1,
        },
});

const entries = [
  entry(1, "2026-09-30", 4, 1000),
  entry(2, "2026-10-01", 2, null),
  entry(3, "2026-10-12", 6, 3000),
  entry(4, "2026-10-12", 1.5, 500),
  entry(5, "2026-12-03", 3, 100),
];

describe("releasesByMonth", () => {
  it("lays the month out in Monday-to-Sunday weeks", () => {
    const month = releasesByMonth(entries, "2026-10");
    // 1 Oct 2026 is a Thursday; 31 Oct a Saturday.
    expect(month.weeks[0].days[0]).toMatchObject({ date: "2026-09-28", inMonth: false });
    expect(month.weeks.at(-1).days.at(-1)).toMatchObject({ date: "2026-11-01", inMonth: false });
    expect(month.weeks.every((w) => w.days.length === 7)).toBe(true);
    expect(month.weeks).toHaveLength(5);
  });

  it("totals the month from its own days and each week from the whole row", () => {
    const month = releasesByMonth(entries, "2026-10");
    expect(month.entries.map((e) => e.pr)).toEqual([4, 3, 2]);
    expect(month.totals).toEqual({
      entries: 3,
      estimateHours: 9.5,
      tokens: 3500,
      activeHours: 3.8,
    });
    // The first row starts on 28 Sep, so it also carries PR 1.
    expect(month.weeks[0].totals).toMatchObject({ entries: 2, estimateHours: 6, tokens: 1000 });
    const twelfth = month.weeks.flatMap((w) => w.days).find((d) => d.date === "2026-10-12");
    expect(twelfth.entries.map((e) => e.pr)).toEqual([4, 3]);
  });

  it("links to the nearest months with entries, skipping empty ones", () => {
    expect(releasesByMonth(entries, "2026-10")).toMatchObject({ prev: "2026-09", next: "2026-12" });
    const empty = releasesByMonth(entries, "2026-11");
    expect(empty).toMatchObject({ prev: "2026-10", next: "2026-12", entries: [] });
    expect(empty.totals).toEqual({ entries: 0, estimateHours: 0, tokens: 0, activeHours: 0 });
  });

  it("refuses a malformed month", () => {
    expect(() => releasesByMonth(entries, "2026-13")).toThrow();
  });
});

describe("releaseMonths and releaseTotals", () => {
  it("lists months newest first and counts unmeasured entries as zero tokens", () => {
    expect(releaseMonths(entries)).toEqual(["2026-12", "2026-10", "2026-09"]);
    expect(releaseTotals([entry(9, "2026-10-01", 2, null)]).tokens).toBe(0);
  });
});
