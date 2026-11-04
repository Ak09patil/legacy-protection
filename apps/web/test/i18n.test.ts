/**
 * The checks that stand in for a native-speaker review on every build.
 * They can't judge tone, but they catch what goes wrong most often with
 * machine translation: a dropped name or number, an English leftover, a
 * sentence that grew long and hard, and a server message nobody translated.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fromAcceptLanguage, LOCALES } from "@/i18n/config";
import { ERROR_CATALOG, translateError } from "@/i18n/errors";
import { MESSAGES } from "@/i18n/messages";
import { readability, syllables } from "@/i18n/readability";

type Leaf = { path: string; value: string | ((...a: never[]) => string) };

function leaves(obj: unknown, path = ""): Leaf[] {
  if (typeof obj === "string" || typeof obj === "function") return [{ path, value: obj as Leaf["value"] }];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
}

// Distinct sentinels: a translation that drops or swaps an argument is caught.
const SENTINELS = ["Ⓐxq", "Ⓑxq", "Ⓒxq"];
const render = (v: Leaf["value"]) => (typeof v === "string" ? v : (v as (...a: string[]) => string)(...SENTINELS));
const arity = (v: Leaf["value"]) => (typeof v === "function" ? v.length : 0);

const en = new Map(leaves(MESSAGES.en).map((l) => [l.path, l]));

// Words that are the same in every language on purpose.
const SAME_EVERYWHERE = new Set(["common.appName", "editor.name", "plan.theirName", "payment.hist.PAYMENT_RELEASED", "executor.stepPay", "editor.suggestLine"]);

describe.each(["de", "es"] as const)("%s messages", (locale) => {
  const mine = leaves(MESSAGES[locale]);

  it("have exactly the same keys as English", () => {
    expect(mine.map((l) => l.path).sort()).toEqual([...en.keys()].sort());
  });

  it("keep every name, number and date they're given, and take the same arguments", () => {
    for (const l of mine) {
      const ref = en.get(l.path)!;
      expect(arity(l.value), l.path).toBe(arity(ref.value));
      const out = render(l.value);
      // Arguments a function may legitimately not show (e.g. an optional person) are those English also omits.
      for (const s of SENTINELS.slice(0, arity(ref.value))) {
        if (render(ref.value).includes(s)) expect(out, `${l.path} dropped an argument`).toContain(s);
      }
    }
  });

  it("aren't English left behind", () => {
    const leftovers = mine.filter((l) => !SAME_EVERYWHERE.has(l.path) && render(l.value) === render(en.get(l.path)!.value) && render(l.value).length > 6);
    expect(leftovers.map((l) => l.path)).toEqual([]);
  });

  it("aren't much longer than English, so buttons and headings still fit", () => {
    for (const l of mine) {
      const a = render(l.value).length;
      const b = render(en.get(l.path)!.value).length;
      expect(a, `${l.path}: "${render(l.value)}"`).toBeLessThanOrEqual(Math.max(32, b * 2.2));
    }
  });

  it("have no doubled spaces, stray quotes or untranslated placeholders", () => {
    for (const l of mine) {
      const s = render(l.value);
      expect(s, l.path).not.toMatch(/ {2}|\$\{|undefined|\bTODO\b|"|"$/);
    }
  });
});

describe("plain language", () => {
  // Long-form messages only: labels and buttons are too short to score fairly.
  const prose = (locale: (typeof LOCALES)[number]) =>
    leaves(MESSAGES[locale])
      .map((l) => render(l.value).replace(/Ⓐxq|Ⓑxq|Ⓒxq/g, "Maria"))
      .filter((s) => s.split(/\s+/).length >= 12);

  it("English averages about a 6th-to-8th grade reading level", () => {
    const grades = prose("en").map((s) => readability(s, "en").score);
    const avg = grades.reduce((a, b) => a + b, 0) / grades.length;
    expect(avg).toBeLessThanOrEqual(8);
  });

  it("German averages plain reading ease (Amstad ≥ 55)", () => {
    const scores = prose("de").map((s) => readability(s, "de").score);
    expect(scores.reduce((a, b) => a + b, 0) / scores.length).toBeGreaterThanOrEqual(55);
  });

  it("Spanish averages plain reading ease (Fernández-Huerta ≥ 65)", () => {
    const scores = prose("es").map((s) => readability(s, "es").score);
    expect(scores.reduce((a, b) => a + b, 0) / scores.length).toBeGreaterThanOrEqual(65);
  });

  it("no single sentence runs on (at most 32 words) in any language", () => {
    for (const locale of LOCALES) {
      for (const text of prose(locale)) {
        for (const sentence of text.split(/(?<=[.!?])\s+/)) {
          expect(sentence.split(/\s+/).length, `${locale}: ${sentence}`).toBeLessThanOrEqual(32);
        }
      }
    }
  });

  it("the syllable counter agrees with a dictionary on common words", () => {
    expect([syllables("payment", "en"), syllables("money", "en"), syllables("protected", "en"), syllables("okay", "en")]).toEqual([2, 2, 3, 2]);
    expect([syllables("Zahlung", "de"), syllables("Vertrauensperson", "de"), syllables("heute", "de")]).toEqual([2, 5, 2]);
    expect([syllables("pago", "es"), syllables("persona", "es"), syllables("cuidado", "es"), syllables("poeta", "es")]).toEqual([2, 3, 3, 3]);
  });
});

describe("server messages", () => {
  // Every English message the server can send back must have a German and Spanish line.
  const root = join(__dirname, "..", "src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  const policyPlan = join(__dirname, "..", "..", "..", "packages", "policy", "src", "plan.ts");
  const sources = [...files(join(root, "server")), join(root, "app", "(app)", "actions.ts"), policyPlan].map((f) => readFileSync(f, "utf8"));
  const found = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/message: "([^"]+)"|issues: \["([^"]+)"\]|\.(?:min|email|regex|refine)\([^"\n)]*"([A-Z][^"]+)"\)|message: "([^"]+)",\s*path/g)) {
      const s = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (s) found.add(s);
    }
  }

  it("found the messages it is meant to check", () => {
    expect(found.size).toBeGreaterThan(20);
  });

  it.each([...new Set(["de", "es"] as const)])("INV-25 every server message has a translation (%s)", (locale) => {
    const missing = [...found].filter((s) => !ERROR_CATALOG[s]?.[locale]);
    expect(missing).toEqual([]);
  });

  it("English passes through; an unknown message never shows English to a German or Spanish reader", () => {
    expect(translateError("en", "Payment not found.")).toBe("Payment not found.");
    expect(translateError("de", "Payment not found.")).toBe("Zahlung nicht gefunden.");
    expect(translateError("es", "Something new and unlisted")).toBe("Revise esta parte otra vez, por favor.");
  });
});

describe("choosing a language", () => {
  it("follows the browser when the reader hasn't chosen", () => {
    expect(fromAcceptLanguage("de-AT,de;q=0.9,en;q=0.5")).toBe("de");
    expect(fromAcceptLanguage("es-MX")).toBe("es");
    expect(fromAcceptLanguage("fr-FR,es;q=0.6")).toBe("es");
    expect(fromAcceptLanguage("fr-FR")).toBe("en");
    expect(fromAcceptLanguage(undefined)).toBe("en");
  });
});
