// The handful of vitest matchers these tests use, on node:assert, so the suite runs
// with `node --test` and no dependencies.
import assert from "node:assert/strict";

const matches = (actual, expected) =>
  expected !== null && typeof expected === "object"
    ? actual !== null &&
      typeof actual === "object" &&
      Object.entries(expected).every(([k, v]) => matches(actual[k], v))
    : Object.is(actual, expected);

export const expect = (actual) => ({
  toBe: (expected) => assert.strictEqual(actual, expected),
  toEqual: (expected) => assert.deepStrictEqual(actual, expected),
  toBeNull: () => assert.strictEqual(actual, null),
  toHaveLength: (n) => assert.strictEqual(actual.length, n),
  toMatchObject: (expected) =>
    assert.ok(matches(actual, expected), `expected ${JSON.stringify(actual)} to match ${JSON.stringify(expected)}`),
  toThrow: (pattern) => assert.throws(actual, pattern instanceof RegExp ? pattern : undefined),
});
