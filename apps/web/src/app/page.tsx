import dynamic from "next/dynamic";
import { CursorBadge } from "@/components/CursorBadge";
import { Chapters } from "@/components/sections/Chapters";
import { Closing } from "@/components/sections/Closing";
import { Hero } from "@/components/sections/Hero";
import { Nav } from "@/components/sections/Nav";
import { Proof } from "@/components/sections/Proof";

// WebGL only runs in the browser; the fixed stage reserves no layout space, so nothing shifts when it loads.
const AuraScene = dynamic(() => import("@/components/scene/AuraScene"));

export default function Home() {
  return (
    <>
      <div className="aura-field" aria-hidden="true">
        <span className="f1" />
        <span className="f2" />
        <span className="f3" />
      </div>
      <AuraScene />
      <CursorBadge />
      <Nav />
      <main className="relative z-10">
        <Hero />
        <Chapters />
        <Proof />
      </main>
      <div className="relative z-10">
        <Closing />
      </div>
    </>
  );
}
