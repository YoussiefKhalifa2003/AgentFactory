"use client";

import { Text } from "@react-three/drei";
import { Activity } from "@/lib/types";

export function SpeechBubble({ caption, activity }: { caption?: string; activity: Activity }) {
  const busy = activity !== "idle" && activity !== "done" && activity !== "blocked";
  const text = (caption || "").trim();
  if (!busy || !text) return null;
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("shot")) return null;
  const line = text.length > 48 ? `${text.slice(0, 45)}…` : text;
  return (
    <group position={[0.28, 1.22, 0]}>
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[Math.min(1.4, 0.28 + line.length * 0.028), 0.22]} />
        <meshBasicMaterial color="#fffdf8" />
      </mesh>
      <Text
        position={[0, 0, 0.01]}
        fontSize={0.055}
        color="#1c1814"
        anchorX="center"
        anchorY="middle"
        maxWidth={1.2}
      >
        {line}
      </Text>
    </group>
  );
}
