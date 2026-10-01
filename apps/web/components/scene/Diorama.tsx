"use client";

import { DioramaCanvas } from "./SceneRoot";

export function Diorama() {
  return (
    <div className="relative h-full w-full">
      <DioramaCanvas />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/20 via-black/5 to-transparent px-4 pb-3 pt-8">
        <span className="display text-[1.25rem] text-white drop-shadow-sm">Office</span>
        <span className="text-[11px] text-white/85">Click to walk in</span>
      </div>
    </div>
  );
}
