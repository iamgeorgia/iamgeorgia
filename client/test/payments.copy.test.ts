import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { en } from "../lib/i18n/ui/en";
import { he } from "../lib/i18n/ui/he";
import { ka } from "../lib/i18n/ui/ka";
import { ru } from "../lib/i18n/ui/ru";
import { DECLINE_REASON_KEYS, declineReasonKey } from "../lib/payments/declineReason";

/** Every dotted path to a string leaf, so two dictionaries can be compared key for key. */
const leafPaths = (value: unknown, prefix = ""): string[] => {
  if (typeof value === "string") return [prefix];
  if (value === null || typeof value !== "object") return [];

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
};

const dictionaries = { en, ka, ru, he } as const;

/** `{name}` placeholders in a string, sorted. */
const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();

const valueAt = (root: unknown, path: string): string =>
  path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], root) as string;

describe("payment copy", () => {
  it("exists in every language", () => {
    for (const [code, dictionary] of Object.entries(dictionaries)) {
      assert.ok(dictionary.payment, `${code} has a payment block`);
      assert.ok(leafPaths(dictionary.payment).length > 40, `${code} payment block is populated`);
    }
  });

  it("has identical key sets in en, ka, ru and he", () => {
    const expected = leafPaths(en.payment).sort();

    for (const code of ["ka", "ru", "he"] as const) {
      assert.deepEqual(leafPaths(dictionaries[code].payment).sort(), expected, `${code} keys match en`);
    }
  });

  it("keeps the same placeholders in every translation", () => {
    for (const path of leafPaths(en.payment)) {
      const expected = placeholders(valueAt(en.payment, path));

      for (const code of ["ka", "ru", "he"] as const) {
        assert.deepEqual(
          placeholders(valueAt(dictionaries[code].payment, path)),
          expected,
          `${code} payment.${path} keeps its placeholders`,
        );
      }
    }
  });

  it("leaves no empty strings", () => {
    for (const [code, dictionary] of Object.entries(dictionaries)) {
      for (const path of leafPaths(dictionary.payment)) {
        assert.notEqual(valueAt(dictionary.payment, path).trim(), "", `${code} payment.${path} is not empty`);
      }
    }
  });

  it("no longer says that no payment is taken online", () => {
    const stale = [/take no payment online/i, /no online payment/i];

    for (const text of leafPaths(en).map((path) => valueAt(en, path))) {
      for (const pattern of stale) assert.ok(!pattern.test(text), `stale copy: ${text.slice(0, 80)}`);
    }
  });
});

describe("decline reasons", () => {
  const expected: Record<string, keyof typeof en.payment.declineReasons> = {
    "1037": "insufficientFunds",
    "1003": "invalidCvv",
    "1024": "threeDsFailed",
    "1025": "invalidExpiry",
    "1051": "fraudCheck",
    "1052": "orderExpired",
  };

  it("maps every listed response code", () => {
    for (const [code, key] of Object.entries(expected)) {
      assert.equal(declineReasonKey(code), key);
      assert.equal(declineReasonKey(Number(code)), key);
      assert.equal(DECLINE_REASON_KEYS[code as keyof typeof DECLINE_REASON_KEYS], key);
    }
  });

  it("falls back to the generic reason", () => {
    for (const code of [null, undefined, "", "9999", 0, "abc"]) {
      assert.equal(declineReasonKey(code), "generic");
    }
  });

  it("has a sentence in every language for every key it can return", () => {
    const keys = [...Object.values(expected), "generic"];

    for (const dictionary of Object.values(dictionaries)) {
      for (const key of keys) {
        assert.ok(
          (dictionary.payment.declineReasons as Record<string, string>)[key],
          `declineReasons.${key} exists`,
        );
      }
    }
  });
});
