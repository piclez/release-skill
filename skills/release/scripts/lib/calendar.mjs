// The month calendar model behind the client's delivery page. Pure date math, no I/O.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isReleaseMonth = (value) => MONTH.test(value);

/** Months that have at least one entry, newest first. */
export function releaseMonths(entries) {
  return [...new Set(entries.map((e) => e.date.slice(0, 7)))].sort().reverse();
}

export function releaseTotals(entries) {
  const sum = (pick) => Math.round(entries.reduce((n, e) => n + pick(e), 0) * 10) / 10;
  return {
    entries: entries.length,
    estimateHours: sum((e) => e.estimateHours),
    tokens: entries.reduce((n, e) => n + (e.measured?.tokens.total ?? 0), 0),
    activeHours: sum((e) => e.measured?.activeHours ?? 0),
  };
}

const iso = (d) => d.toISOString().slice(0, 10);

const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.pr - a.pr;

/**
 * The calendar for one month: Monday-to-Sunday weeks covering it, each day's entries,
 * and totals per week and for the month. Dates are calendar days, so the math is UTC.
 */
export function releasesByMonth(entries, month) {
  if (!isReleaseMonth(month)) throw new Error(`Invalid month ${month}`);
  const [year, mon] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, mon - 1, 1));
  const last = new Date(Date.UTC(year, mon, 0));
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const end = new Date(last);
  end.setUTCDate(last.getUTCDate() + (6 - ((last.getUTCDay() + 6) % 7)));

  const byDate = new Map();
  for (const entry of [...entries].sort(newestFirst)) {
    byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);
  }

  const weeks = [];
  for (const cursor = new Date(start); cursor <= end;) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = iso(cursor);
      days.push({
        date,
        day: cursor.getUTCDate(),
        inMonth: date.startsWith(month),
        entries: byDate.get(date) ?? [],
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push({ days, totals: releaseTotals(days.flatMap((d) => d.entries)) });
  }

  const inMonth = entries.filter((e) => e.date.startsWith(month)).sort(newestFirst);
  const months = releaseMonths(entries);
  return {
    month,
    weeks,
    entries: inMonth,
    totals: releaseTotals(inMonth),
    prev: months.find((m) => m < month) ?? null,
    next: [...months].reverse().find((m) => m > month) ?? null,
  };
}
