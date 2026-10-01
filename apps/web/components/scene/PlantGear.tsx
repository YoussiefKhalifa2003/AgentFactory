"use client";

import { PlantSnapshot } from "@/lib/types";

function Rack({
  position,
  on,
  busy,
}: {
  position: [number, number, number];
  on: boolean;
  busy: boolean;
}) {
  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.32, 0.82, 0.26]} />
        <meshStandardMaterial color="#8d7b6c" roughness={0.55} metalness={0.08} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0.12, 0.22 - i * 0.14, 0.1]}>
          <boxGeometry args={[0.04, 0.05, 0.04]} />
          <meshStandardMaterial
            color={on ? (busy ? "#2f7d4a" : "#c9a227") : "#c45c2c"}
            emissive={on ? (busy ? "#2f7d4a" : "#c9a227") : "#c45c2c"}
            emissiveIntensity={busy ? 0.8 : on ? 0.28 : 0.08}
          />
        </mesh>
      ))}
    </group>
  );
}

export function PlantGear({
  plant,
  width,
}: {
  plant: PlantSnapshot | null;
  width: number;
  depth: number;
}) {
  const x = width - 0.05;
  return (
    <group>
      <Rack position={[x, 0.42, 1.05]} on={Boolean(plant?.spark1?.ok)} busy={Boolean(plant?.spark1?.busy)} />
      <Rack position={[x, 0.42, 1.48]} on={Boolean(plant?.spark2?.ok)} busy={Boolean(plant?.spark2?.busy)} />
    </group>
  );
}
