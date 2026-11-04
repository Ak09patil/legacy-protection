"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ChapterMarker } from "./ChapterMarker";

/** The one orchestrated entrance on the page: the headline settles in, line by line. */
const HEADLINE = "Every payment app assumes you’ll always be there to press confirm.";

export function Hero() {
  const reduce = useReducedMotion();
  return (
    <ChapterMarker
      chapter="hero"
      as="header"
      id="top"
      labelledBy="hero-title"
      className="relative flex min-h-[100svh] items-center px-5 pb-20 pt-32 sm:px-10 lg:px-16"
    >
      <div className="max-w-[40rem]">
        <h1
          id="hero-title"
          className="text-balance font-display text-[clamp(2.5rem,5.6vw,4.7rem)] font-[380] leading-[1.04] tracking-[-0.025em] [font-variation-settings:'SOFT'_100,'opsz'_144]"
        >
          {HEADLINE.split(" ").map((word, i) => (
            <motion.span
              key={`${word}-${i}`}
              className="inline-block whitespace-pre"
              initial={reduce ? false : { opacity: 0, y: 22, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 1.1, delay: 0.15 + i * 0.07, ease: [0.22, 0.8, 0.24, 1] }}
            >
              {word + " "}
            </motion.span>
          ))}
        </h1>
        <motion.div
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2, delay: 0.95 }}
        >
          <p className="mt-8 max-w-[34rem] text-[clamp(1.08rem,1.6vw,1.25rem)] leading-[1.6] text-ink-soft">
            Legacy Protection is a quiet safety net inside PayPal. It pauses scams before your money
            leaves, and if one day you can’t manage things yourself, it carries out the wishes you set
            while you were well.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-4">
            <a
              href="#demo"
              className="rounded-full bg-gradient-to-br from-green-2 to-green px-7 py-4 text-[17px] font-semibold text-white shadow-[0_18px_36px_-16px_rgba(46,94,69,0.75)] transition-transform duration-300 ease-calm hover:-translate-y-0.5"
            >
              Watch the demo
            </a>
            <a href="#how" className="text-[17px] font-semibold text-green underline decoration-mint decoration-2 underline-offset-[6px] hover:decoration-green">
              See how it works
            </a>
          </div>
        </motion.div>
      </div>
    </ChapterMarker>
  );
}
