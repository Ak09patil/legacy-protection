"use client";

import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { useEffect, useState } from "react";
import { story } from "@/lib/story";

/**
 * A small badge that trails the pointer over empty space near the rings,
 * inviting a gentle move. Mouse users only; hidden over text and controls.
 */
export function CursorBadge() {
  const reduce = useReducedMotion();
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);
  const x = useMotionValue(-200);
  const y = useMotionValue(-200);
  const sx = useSpring(x, { stiffness: 180, damping: 22, mass: 0.6 });
  const sy = useSpring(y, { stiffness: 180, damping: 22, mass: 0.6 });

  useEffect(() => {
    if (reduce || !window.matchMedia("(pointer: fine)").matches) return;
    setEnabled(true);
    const onMove = (e: PointerEvent) => {
      x.set(e.clientX + 18);
      y.set(e.clientY + 18);
      const el = e.target as HTMLElement | null;
      const overContent = !!el?.closest("a, button, p, h1, h2, h3, li, nav, [data-no-badge]");
      const nearRings = e.clientX > window.innerWidth * 0.5 && story.chapter !== "proof";
      setVisible(!overContent && nearRings);
    };
    const onScroll = () => {
      if (story.chapter === "proof") setVisible(false);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, [reduce, x, y]);

  if (!enabled) return null;
  return (
    <motion.div
      aria-hidden="true"
      style={{ x: sx, y: sy }}
      animate={{ opacity: visible ? 1 : 0, scale: visible ? 1 : 0.85 }}
      transition={{ duration: 0.35 }}
      className="pointer-events-none fixed left-0 top-0 z-40 rounded-full bg-white/70 px-4 py-2 text-[14px] font-semibold text-green shadow-[0_10px_30px_-12px_rgba(16,36,27,0.4)] backdrop-blur-xl"
    >
      Move gently
    </motion.div>
  );
}
