/**
 * A tiny shared store for the scroll story. The 3D scene reads it every frame
 * without causing React re-renders; sections write to it when they come into view.
 */

export type Chapter = "hero" | "well" | "wrong" | "cant-act" | "proof";

export interface StoryState {
  chapter: Chapter;
  /** Pointer position in -1..1, for gentle tilt. */
  pointer: { x: number; y: number };
  /** True when the user asked their device for less motion. */
  reducedMotion: boolean;
}

export const story: StoryState = {
  chapter: "hero",
  pointer: { x: 0, y: 0 },
  reducedMotion: false,
};

/** Visual targets per chapter. The scene eases toward these. */
export const CHAPTER_TARGETS: Record<Chapter, { spread: number; amber: number; link: number; dim: number; x: number }> = {
  hero: { spread: 0, amber: 0, link: 0, dim: 0, x: 1 },
  well: { spread: 0.15, amber: 0, link: 0, dim: 0, x: 1 },
  wrong: { spread: 0.08, amber: 1, link: 0, dim: 0, x: 1 },
  "cant-act": { spread: 0.1, amber: 0, link: 1, dim: 0, x: 0.75 },
  proof: { spread: 1, amber: 0, link: 0, dim: 0.65, x: 0 },
};
