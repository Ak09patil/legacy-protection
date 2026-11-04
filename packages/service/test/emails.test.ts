import { describe, expect, it } from "vitest";
import { EMAILS, emailLocale, emailMoney } from "../src/emails.js";

const args = ["Ⓐxq", "Ⓑxq", "https://ⓒxq"];
const call = (f: (...a: string[]) => readonly [string, string]) => f(...args.slice(0, f.length));

describe("emails in every language", () => {
  const names = Object.keys(EMAILS.en) as Array<keyof typeof EMAILS.en>;

  it.each(["de", "es"] as const)("%s has every email English has, and keeps every name, link and code", (lang) => {
    expect(Object.keys(EMAILS[lang]).sort()).toEqual([...names].sort());
    for (const name of names) {
      const [enSubject, enBody] = call(EMAILS.en[name] as never);
      const [subject, body] = call(EMAILS[lang][name] as never);
      const enAll = `${enSubject}\n${enBody}`;
      const all = `${subject}\n${body}`;
      for (const a of args) if (enAll.includes(a)) expect(all, `${lang}.${name} lost ${a}`).toContain(a);
      // The secret invitation link is filled in by the delivery worker; the placeholder must survive translation.
      expect(all.includes("{{link}}"), `${lang}.${name}`).toBe(enAll.includes("{{link}}"));
      expect(subject).not.toEqual(enSubject);
      expect(subject.length, `${lang}.${name} subject`).toBeLessThanOrEqual(80);
    }
  });

  it("the sign-in code is in the subject and the body, in every language", () => {
    for (const lang of ["en", "de", "es"] as const) {
      const [s, b] = EMAILS[lang].signInCode("123456");
      expect(s).toContain("123456");
      expect(b).toContain("123456");
    }
  });

  it("an unknown or missing language falls back to English", () => {
    expect(emailLocale("fr")).toBe("en");
    expect(emailLocale(null)).toBe("en");
    expect(emailLocale("de")).toBe("de");
  });

  it("money reads the way the recipient writes it", () => {
    expect(emailMoney("en", 120000)).toBe("$1,200.00");
    expect(emailMoney("de", 120000)).toMatch(/^1\.200,00\s\$$/);
    expect(emailMoney("es", "120000")).toMatch(/^1\.?200,00\sUS\$$/);
  });

  it("no email ever asks anyone to send money or share a code with a person", () => {
    for (const lang of ["en", "de", "es"] as const) {
      for (const name of names) {
        const [s, b] = call(EMAILS[lang][name] as never);
        expect(`${s} ${b}`).not.toMatch(/send (us|me) money|share (the|your) code with|geben sie (den|ihren) code|comparta (el|su) código/i);
      }
    }
  });
});
