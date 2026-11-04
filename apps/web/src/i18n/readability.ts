/**
 * Readability scores for our own messages, one formula per language, each the
 * standard one for that language:
 *   English: Flesch–Kincaid grade level (lower is easier; 6 ≈ age 11–12)
 *   German:  Flesch reading ease, Amstad (1978) (higher is easier; 60+ ≈ plain)
 *   Spanish: Fernández-Huerta (1959) (higher is easier; 60+ ≈ plain)
 *
 * Syllables are counted by vowel groups with each language's diphthongs. That
 * is an estimate, as every automated readability tool's is; it's good enough
 * to stop a sentence getting long and hard without anyone noticing.
 */

import type { Locale } from "./config";

const words = (text: string) => text.match(/[\p{L}’'-]+/gu)?.filter((w) => /\p{L}/u.test(w)) ?? [];
const sentences = (text: string) => Math.max(1, text.split(/[.!?…:;]+(?:\s|$)/u).filter((s) => /\p{L}/u.test(s)).length);

export function syllables(word: string, locale: Locale): number {
  const w = word.toLowerCase().replace(/[’'-]/g, "");
  if (locale === "en") {
    if (w.length <= 3) return 1;
    const trimmed = w.replace(/(?:[^laeiouy]es|[^td]ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    return Math.max(1, trimmed.match(/[aeiouy]{1,2}/g)?.length ?? 1);
  }
  if (locale === "de") {
    const v = w.replace(/äu|eu|ei|ai|au|ie/g, "a|");
    return Math.max(1, v.match(/[aeiouyäöü]+/g)?.length ?? 1);
  }
  // Spanish: a group of vowels is one syllable, except two "strong" vowels (a, e, o) side by side, which split.
  let n = 0;
  for (const g of w.match(/[aeiouáéíóúü]+/g) ?? []) {
    n += 1 + (g.match(/[aeoáéó](?=[aeoáéó])/g)?.length ?? 0) + (g.match(/[íú]/g) && g.length > 1 ? 1 : 0);
  }
  return Math.max(1, n);
}

export interface Readability {
  words: number;
  sentences: number;
  wordsPerSentence: number;
  syllablesPerWord: number;
  /** FK grade for English; reading ease for German and Spanish. */
  score: number;
}

export function readability(text: string, locale: Locale): Readability {
  const ws = words(text);
  const n = Math.max(1, ws.length);
  const s = sentences(text);
  const syl = ws.reduce((a, w) => a + syllables(w, locale), 0);
  const asl = n / s;
  const asw = syl / n;
  const score =
    locale === "en"
      ? 0.39 * asl + 11.8 * asw - 15.59
      : locale === "de"
        ? 180 - asl - 58.5 * asw
        : 206.84 - 60 * asw - 1.02 * asl;
  return { words: ws.length, sentences: s, wordsPerSentence: asl, syllablesPerWord: asw, score };
}
