"use client";

import { useEffect, useRef } from "react";
import { story, type Chapter } from "@/lib/story";

/**
 * Wraps a section and tells the 3D scene which chapter is on screen.
 * The section whose middle band overlaps the viewport centre wins.
 */
export function ChapterMarker({
  chapter,
  children,
  className,
  id,
  as: Tag = "section",
  labelledBy,
}: {
  chapter: Chapter;
  children: React.ReactNode;
  className?: string;
  id?: string;
  as?: "section" | "header" | "div";
  labelledBy?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) story.chapter = chapter;
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [chapter]);

  return (
    <Tag ref={ref as never} id={id} className={className} aria-labelledby={labelledBy}>
      {children}
    </Tag>
  );
}
