"use client";

import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { story } from "@/lib/story";
import { AuraRings } from "./AuraRings";

function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Fixed full-screen stage behind the page. Falls back to static CSS rings when
 * WebGL isn’t available; freezes animation when the user prefers reduced motion.
 */
export default function AuraScene() {
  const [mode, setMode] = useState<"pending" | "webgl" | "static">("pending");
  const [density, setDensity] = useState(1);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => (story.reducedMotion = mq.matches);
    sync();
    mq.addEventListener("change", sync);

    setDensity(window.innerWidth < 640 ? 0.55 : 1);
    setMode(webglAvailable() ? "webgl" : "static");

    const onMove = (e: PointerEvent) => {
      story.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      story.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div aria-hidden="true" className="fixed inset-0 z-[1] pointer-events-none">
      {mode === "static" && (
        <div className="static-rings absolute right-[-10vmin] top-1/2 h-[80vmin] w-[80vmin] -translate-y-1/2 opacity-90 max-md:right-1/2 max-md:translate-x-1/2" />
      )}
      {mode === "webgl" && (
        <Canvas
          dpr={[1, 1.75]}
          camera={{ position: [0, 0, 5], fov: 45 }}
          gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
        >
          <AuraRings density={density} />
        </Canvas>
      )}
    </div>
  );
}
