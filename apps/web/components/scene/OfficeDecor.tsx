"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox, Text } from "@react-three/drei";
import * as THREE from "three";
import { deskPos } from "./layout";

type V3 = [number, number, number];

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ---------- Plants ---------- */

function Pot({ color, r = 0.17, h = 0.34 }: { color: string; r?: number; h?: number }) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r * 0.74, h, 24]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      <mesh position={[0, h, 0]} castShadow>
        <torusGeometry args={[r, 0.013, 8, 28]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      <mesh position={[0, h - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[r - 0.01, 24]} />
        <meshStandardMaterial color="#2b1e16" roughness={1} />
      </mesh>
    </group>
  );
}

export function LeafyPlant({
  position,
  scale = 1,
  potColor = "#d9d2c5",
  seed = 1,
}: {
  position: V3;
  scale?: number;
  potColor?: string;
  seed?: number;
}) {
  const leaves = useMemo(() => {
    const r = rng(seed * 97 + 13);
    const greens = ["#2f6b43", "#3d8050", "#4f9a5e", "#2a5c3b", "#5aa868"];
    return Array.from({ length: 26 }, (_, i) => {
      const t = i / 26;
      return {
        a: i * 2.399 + r() * 0.4,
        y: 0.36 + t * 0.5,
        tilt: -0.25 - (1 - t) * 0.65 - r() * 0.2,
        out: 0.04 + (1 - t) * 0.06,
        len: 0.3 + r() * 0.14 - t * 0.08,
        color: greens[Math.floor(r() * greens.length)],
      };
    });
  }, [seed]);
  return (
    <group position={position} scale={scale}>
      <Pot color={potColor} />
      {leaves.map((l, i) => (
        <group key={i} rotation={[0, l.a, 0]} position={[0, l.y, 0]}>
          <mesh position={[0, 0.0, l.out + l.len * 0.45]} rotation={[l.tilt, 0, 0]} scale={[0.11, 0.022, l.len]} castShadow>
            <sphereGeometry args={[1, 10, 8]} />
            <meshStandardMaterial color={l.color} roughness={0.7} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function SnakePlant({
  position,
  scale = 1,
  potColor = "#2a2623",
  seed = 1,
}: {
  position: V3;
  scale?: number;
  potColor?: string;
  seed?: number;
}) {
  const blades = useMemo(() => {
    const r = rng(seed * 31 + 7);
    return Array.from({ length: 11 }, (_, i) => {
      const a = (i / 11) * Math.PI * 2 + r();
      const d = 0.03 + r() * 0.07;
      return {
        x: Math.cos(a) * d,
        z: Math.sin(a) * d,
        h: 0.55 + r() * 0.5,
        rx: Math.sin(a) * 0.12,
        rz: -Math.cos(a) * 0.12,
        c: i % 3 === 0 ? "#6a8f3f" : "#2d5a3a",
      };
    });
  }, [seed]);
  return (
    <group position={position} scale={scale}>
      <Pot color={potColor} r={0.15} h={0.3} />
      {blades.map((b, i) => (
        <mesh key={i} position={[b.x, 0.3 + b.h / 2, b.z]} rotation={[b.rx, 0, b.rz]} scale={[1, 1, 0.35]} castShadow>
          <coneGeometry args={[0.055, b.h, 5]} />
          <meshStandardMaterial color={b.c} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

export function FiddlePlant({ position, scale = 1, seed = 1 }: { position: V3; scale?: number; seed?: number }) {
  const leaves = useMemo(() => {
    const r = rng(seed * 53 + 5);
    return Array.from({ length: 16 }, (_, i) => ({
      a: i * 2.1 + r() * 0.5,
      y: 0.85 + (i / 16) * 0.85,
      out: 0.08 + r() * 0.12,
      tilt: -0.2 - r() * 0.5,
      s: 0.18 + r() * 0.07,
    }));
  }, [seed]);
  return (
    <group position={position} scale={scale}>
      <Pot color="#c9bfae" r={0.23} h={0.42} />
      <mesh position={[0, 0.95, 0]} castShadow>
        <cylinderGeometry args={[0.018, 0.03, 1.0, 8]} />
        <meshStandardMaterial color="#5b4636" roughness={0.8} />
      </mesh>
      {leaves.map((l, i) => (
        <group key={i} rotation={[0, l.a, 0]} position={[0, l.y, 0]}>
          <mesh position={[0, 0, l.out]} rotation={[l.tilt, 0, 0]} scale={[l.s, 0.02, l.s * 1.25]} castShadow>
            <sphereGeometry args={[1, 12, 10]} />
            <meshStandardMaterial color={i % 4 === 0 ? "#3f8a4e" : "#2f6f40"} roughness={0.6} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ---------- Water dispenser ---------- */

function Bubbles() {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    refs.current.forEach((m, i) => {
      if (!m) return;
      const t = (clock.elapsedTime * 0.35 + i * 0.37) % 1;
      m.position.y = -0.12 + t * 0.3;
      m.position.x = Math.sin(clock.elapsedTime * 2 + i * 2) * 0.03;
      m.scale.setScalar(0.6 + t * 0.6);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t);
    });
  });
  return (
    <group position={[0, 1.22, 0]}>
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => void (refs.current[i] = el)}>
          <sphereGeometry args={[0.014, 8, 8]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export function WaterDispenser({ position, rotationY = 0 }: { position: V3; rotationY?: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0.05]}>
        <circleGeometry args={[0.42, 24]} />
        <meshBasicMaterial color="#000" transparent opacity={0.18} depthWrite={false} />
      </mesh>
      <RoundedBox args={[0.36, 1.02, 0.34]} radius={0.03} position={[0, 0.51, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#eef1f4" roughness={0.32} />
      </RoundedBox>
      <mesh position={[0, 0.16, 0.172]}>
        <boxGeometry args={[0.28, 0.22, 0.006]} />
        <meshStandardMaterial color="#d6dbe0" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.72, 0.172]}>
        <boxGeometry args={[0.3, 0.3, 0.008]} />
        <meshStandardMaterial color="#27313d" roughness={0.3} metalness={0.3} />
      </mesh>
      {[-0.07, 0.07].map((x, i) => (
        <group key={i} position={[x, 0.74, 0.2]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.022, 0.022, 0.07, 12]} />
            <meshStandardMaterial color={i ? "#ef4444" : "#3b82f6"} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.03, -0.02]}>
            <boxGeometry args={[0.03, 0.03, 0.03]} />
            <meshStandardMaterial color={i ? "#ef4444" : "#3b82f6"} roughness={0.35} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.58, 0.2]}>
        <boxGeometry args={[0.3, 0.02, 0.14]} />
        <meshStandardMaterial color="#9aa3ad" metalness={0.8} roughness={0.25} />
      </mesh>
      {/* cup tube */}
      <mesh position={[0.25, 0.86, 0.02]} castShadow>
        <cylinderGeometry args={[0.05, 0.045, 0.22, 16]} />
        <meshStandardMaterial color="#f4f6f8" roughness={0.5} />
      </mesh>
      {/* bottle */}
      <mesh position={[0, 1.24, 0]}>
        <cylinderGeometry args={[0.155, 0.155, 0.44, 28]} />
        <meshStandardMaterial color="#a9dcff" transparent opacity={0.32} roughness={0.05} metalness={0.1} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.142, 0.142, 0.34, 28]} />
        <meshStandardMaterial color="#5db6f2" transparent opacity={0.5} roughness={0.05} emissive="#3aa0e8" emissiveIntensity={0.25} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.5, 0]}>
        <cylinderGeometry args={[0.06, 0.155, 0.1, 24]} />
        <meshStandardMaterial color="#a9dcff" transparent opacity={0.35} roughness={0.05} depthWrite={false} />
      </mesh>
      <mesh position={[0, 1.57, 0]}>
        <cylinderGeometry args={[0.062, 0.062, 0.05, 16]} />
        <meshStandardMaterial color="#2f7fd0" roughness={0.4} />
      </mesh>
      <Bubbles />
    </group>
  );
}

/* ---------- Furniture ---------- */

const BOOK_COLORS = ["#c45c2c", "#2f5a7a", "#e0b45c", "#5d8a86", "#7a3a4a", "#3a3a44", "#8a9a5b", "#e7dccb", "#b5472f"];

export function Bookshelf({ position, night }: { position: V3; night: boolean }) {
  const W = 1.7;
  const H = 2.3;
  const D = 0.36;
  const wood = night ? "#4a382a" : "#8a6241";
  const shelfYs = [0.08, 0.6, 1.1, 1.6, 2.1];
  const books = useMemo(() => {
    const r = rng(42);
    const out: { x: number; y: number; w: number; h: number; c: string; tilt: number }[] = [];
    shelfYs.slice(0, 4).forEach((sy, si) => {
      let x = -W / 2 + 0.07;
      const limit = W / 2 - 0.07 - (si === 1 ? 0.45 : si === 3 ? 0.3 : 0);
      while (x < limit - 0.06) {
        const w = 0.035 + r() * 0.04;
        const h = 0.28 + r() * 0.17;
        const gap = r() < 0.1;
        out.push({
          x: x + w / 2,
          y: sy + 0.02 + h / 2,
          w,
          h,
          c: BOOK_COLORS[Math.floor(r() * BOOK_COLORS.length)],
          tilt: gap ? 0.2 : 0,
        });
        x += w + (gap ? 0.1 : 0.004);
      }
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <group position={position}>
      {[-W / 2, W / 2].map((x, i) => (
        <mesh key={i} position={[x, H / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.05, H, D]} />
          <meshStandardMaterial color={wood} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, H / 2, -D / 2 + 0.01]} receiveShadow>
        <boxGeometry args={[W, H, 0.02]} />
        <meshStandardMaterial color={night ? "#2c2219" : "#6f4e33"} roughness={0.8} />
      </mesh>
      {shelfYs.map((y, i) => (
        <mesh key={i} position={[0, y, 0]} castShadow receiveShadow>
          <boxGeometry args={[W, 0.04, D]} />
          <meshStandardMaterial color={wood} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, H, 0]} castShadow>
        <boxGeometry args={[W + 0.04, 0.04, D + 0.02]} />
        <meshStandardMaterial color={wood} roughness={0.6} />
      </mesh>
      {books.map((b, i) => (
        <mesh key={i} position={[b.x, b.y, 0.0]} rotation={[0, 0, b.tilt]} castShadow>
          <boxGeometry args={[b.w, b.h, D * 0.72]} />
          <meshStandardMaterial color={b.c} roughness={0.7} />
        </mesh>
      ))}
      {/* decor on shelves */}
      <mesh position={[W / 2 - 0.26, 0.6 + 0.2, 0]} castShadow>
        <sphereGeometry args={[0.14, 20, 16]} />
        <meshStandardMaterial color="#e7dccb" roughness={0.3} metalness={0.2} />
      </mesh>
      <mesh position={[W / 2 - 0.22, 1.6 + 0.14, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.05, 0.22, 16]} />
        <meshStandardMaterial color="#5d8a86" roughness={0.35} />
      </mesh>
      <group position={[W / 2 - 0.22, 1.6 + 0.3, 0]}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[Math.sin(i * 1.6) * 0.05, 0.05 + i * 0.03, Math.cos(i * 1.6) * 0.05]} rotation={[0.3 * Math.sin(i), 0, 0.4 * Math.cos(i)]}>
            <coneGeometry args={[0.035, 0.2, 5]} />
            <meshStandardMaterial color="#3d8050" roughness={0.7} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

export function CoffeeBar({ position, night }: { position: V3; night: boolean }) {
  const wood = night ? "#3a2e25" : "#e8ddcc";
  const top = night ? "#5a4636" : "#9b6f47";
  return (
    <group position={position}>
      <RoundedBox args={[2.1, 0.88, 0.62]} radius={0.02} position={[0, 0.44, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={wood} roughness={0.6} />
      </RoundedBox>
      {[-0.52, 0.52].map((x, i) => (
        <group key={i}>
          <mesh position={[x, 0.44, 0.313]}>
            <boxGeometry args={[0.96, 0.74, 0.012]} />
            <meshStandardMaterial color={night ? "#46382d" : "#d8caB4"} roughness={0.55} />
          </mesh>
          <mesh position={[x + (i ? -0.4 : 0.4), 0.5, 0.325]}>
            <cylinderGeometry args={[0.014, 0.014, 0.12, 8]} />
            <meshStandardMaterial color="#b9a27a" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.905, 0.01]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.05, 0.68]} />
        <meshStandardMaterial color={top} roughness={0.45} />
      </mesh>
      {/* espresso machine */}
      <group position={[-0.6, 0.93, -0.05]}>
        <RoundedBox args={[0.42, 0.36, 0.36]} radius={0.03} position={[0, 0.18, 0]} castShadow>
          <meshStandardMaterial color="#2b2b30" roughness={0.3} metalness={0.5} />
        </RoundedBox>
        <mesh position={[0, 0.05, 0.19]}>
          <boxGeometry args={[0.36, 0.03, 0.06]} />
          <meshStandardMaterial color="#9aa3ad" metalness={0.8} roughness={0.25} />
        </mesh>
        <mesh position={[0.12, 0.27, 0.185]}>
          <sphereGeometry args={[0.012, 8, 8]} />
          <meshStandardMaterial color="#6fe28a" emissive="#6fe28a" emissiveIntensity={1.4} />
        </mesh>
        <mesh position={[0, 0.3, 0.185]}>
          <boxGeometry args={[0.16, 0.05, 0.01]} />
          <meshStandardMaterial color="#1a1a1e" emissive="#ffb35c" emissiveIntensity={0.5} />
        </mesh>
      </group>
      {/* mugs */}
      {[0.05, 0.22, 0.39].map((x, i) => (
        <mesh key={i} position={[x, 0.975, 0.12]} castShadow>
          <cylinderGeometry args={[0.04, 0.035, 0.09, 14]} />
          <meshStandardMaterial color={["#c45c2c", "#f4efe6", "#2f5a7a"][i]} roughness={0.35} />
        </mesh>
      ))}
      {/* kettle */}
      <group position={[0.75, 0.93, -0.05]}>
        <mesh position={[0, 0.11, 0]} castShadow>
          <cylinderGeometry args={[0.09, 0.11, 0.22, 20]} />
          <meshStandardMaterial color="#c8ced6" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.24, 0]}>
          <sphereGeometry args={[0.03, 10, 10]} />
          <meshStandardMaterial color="#2b2b30" />
        </mesh>
      </group>
      {/* fruit bowl */}
      <group position={[0.15, 0.93, -0.12]}>
        <mesh position={[0, 0.04, 0]} castShadow>
          <cylinderGeometry args={[0.13, 0.08, 0.08, 20]} />
          <meshStandardMaterial color="#f4efe6" roughness={0.4} />
        </mesh>
        {[
          [-0.04, 0.11, 0, "#e04b3a"],
          [0.05, 0.11, 0.02, "#f0a93a"],
          [0, 0.13, -0.04, "#8bc34a"],
        ].map(([x, y, z, c], i) => (
          <mesh key={i} position={[x as number, y as number, z as number]} castShadow>
            <sphereGeometry args={[0.046, 12, 12]} />
            <meshStandardMaterial color={c as string} roughness={0.5} />
          </mesh>
        ))}
      </group>
      {/* upper shelf */}
      <mesh position={[0, 1.7, -0.16]} castShadow>
        <boxGeometry args={[1.7, 0.04, 0.26]} />
        <meshStandardMaterial color={top} roughness={0.5} />
      </mesh>
      {[-0.7, 0, 0.7].map((x, i) => (
        <mesh key={i} position={[x, 1.78, -0.16]} castShadow>
          <cylinderGeometry args={[0.05, 0.04, 0.12, 14]} />
          <meshStandardMaterial color={["#e7dccb", "#5d8a86", "#c45c2c"][i]} roughness={0.35} />
        </mesh>
      ))}
    </group>
  );
}

export function Sofa({ position, rotationY = 0, night }: { position: V3; rotationY?: number; night: boolean }) {
  const cloth = night ? "#3f5f5c" : "#5d8a86";
  const dark = night ? "#2f4947" : "#4c7571";
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <RoundedBox args={[2.1, 0.3, 0.92]} radius={0.06} position={[0, 0.3, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={dark} roughness={0.92} />
      </RoundedBox>
      {[-0.66, 0, 0.66].map((x, i) => (
        <RoundedBox key={i} args={[0.66, 0.16, 0.72]} radius={0.06} position={[x, 0.53, 0.06]} castShadow>
          <meshStandardMaterial color={cloth} roughness={0.95} />
        </RoundedBox>
      ))}
      <RoundedBox args={[2.1, 0.58, 0.24]} radius={0.08} position={[0, 0.72, -0.36]} castShadow>
        <meshStandardMaterial color={cloth} roughness={0.95} />
      </RoundedBox>
      {[-1, 1].map((s, i) => (
        <RoundedBox key={i} args={[0.18, 0.5, 0.92]} radius={0.07} position={[s * 1.02, 0.56, 0]} castShadow>
          <meshStandardMaterial color={dark} roughness={0.95} />
        </RoundedBox>
      ))}
      {[-0.95, 0.95].map((x) =>
        [-0.38, 0.38].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.07, z]}>
            <cylinderGeometry args={[0.03, 0.022, 0.14, 8]} />
            <meshStandardMaterial color="#3a2c22" roughness={0.5} />
          </mesh>
        ))
      )}
      <RoundedBox args={[0.38, 0.34, 0.12]} radius={0.05} position={[-0.6, 0.78, -0.16]} rotation={[-0.25, 0.2, 0.1]} castShadow>
        <meshStandardMaterial color="#e0b45c" roughness={0.9} />
      </RoundedBox>
      <RoundedBox args={[0.36, 0.34, 0.12]} radius={0.05} position={[0.62, 0.77, -0.16]} rotation={[-0.25, -0.25, -0.1]} castShadow>
        <meshStandardMaterial color="#c45c2c" roughness={0.9} />
      </RoundedBox>
    </group>
  );
}

export function CoffeeTable({ position, night }: { position: V3; night: boolean }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.46, 0.46, 0.04, 36]} />
        <meshStandardMaterial color={night ? "#5a4636" : "#b5895a"} roughness={0.4} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[Math.cos(i * 2.094) * 0.26, 0.19, Math.sin(i * 2.094) * 0.26]} rotation={[Math.sin(i * 2.094) * 0.14, 0, -Math.cos(i * 2.094) * 0.14]}>
          <cylinderGeometry args={[0.014, 0.014, 0.38, 8]} />
          <meshStandardMaterial color="#2a2623" metalness={0.5} roughness={0.35} />
        </mesh>
      ))}
      <mesh position={[0.1, 0.42, 0.06]} rotation={[0, 0.4, 0]} castShadow>
        <boxGeometry args={[0.26, 0.03, 0.19]} />
        <meshStandardMaterial color="#2f5a7a" roughness={0.7} />
      </mesh>
      <mesh position={[0.1, 0.45, 0.06]} rotation={[0, 0.2, 0]} castShadow>
        <boxGeometry args={[0.22, 0.03, 0.16]} />
        <meshStandardMaterial color="#e0b45c" roughness={0.7} />
      </mesh>
      <mesh position={[-0.15, 0.44, -0.08]} castShadow>
        <cylinderGeometry args={[0.04, 0.035, 0.08, 14]} />
        <meshStandardMaterial color="#f4efe6" roughness={0.35} />
      </mesh>
    </group>
  );
}

export function FloorLamp({ position, night }: { position: V3; night: boolean }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.015, 0]}>
        <cylinderGeometry args={[0.16, 0.18, 0.03, 20]} />
        <meshStandardMaterial color="#2a2623" metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.8, 0]} castShadow>
        <cylinderGeometry args={[0.014, 0.014, 1.6, 8]} />
        <meshStandardMaterial color="#2a2623" metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[0, 1.66, 0]}>
        <cylinderGeometry args={[0.16, 0.22, 0.3, 24, 1, true]} />
        <meshStandardMaterial
          color="#f4e6cc"
          emissive="#ffcf8a"
          emissiveIntensity={night ? 1.3 : 0.45}
          roughness={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>
      <pointLight position={[0, 1.6, 0]} intensity={night ? 2.4 : 0.9} distance={5} decay={2} color="#ffc98a" />
    </group>
  );
}

export function Rug({
  position,
  size,
  color,
  accent,
  round = false,
}: {
  position: V3;
  size: [number, number];
  color: string;
  accent: string;
  round?: boolean;
}) {
  return (
    <group position={position}>
      {round ? (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <circleGeometry args={[size[0] / 2, 48]} />
            <meshStandardMaterial color={color} roughness={1} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
            <ringGeometry args={[size[0] / 2 - 0.22, size[0] / 2 - 0.1, 48]} />
            <meshStandardMaterial color={accent} roughness={1} />
          </mesh>
        </>
      ) : (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={size} />
            <meshStandardMaterial color={color} roughness={1} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
            <planeGeometry args={[size[0] - 0.3, size[1] - 0.3]} />
            <meshStandardMaterial color={accent} roughness={1} transparent opacity={0.45} />
          </mesh>
        </>
      )}
    </group>
  );
}

export function Bin({ position, color = "#3a3a44" }: { position: V3; color?: string }) {
  return (
    <mesh position={[position[0], 0.22, position[2]]} castShadow>
      <cylinderGeometry args={[0.15, 0.12, 0.44, 18]} />
      <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} />
    </mesh>
  );
}

function WallArt({
  position,
  rotationY = 0,
  w = 0.9,
  h = 1.2,
  palette,
  night,
}: {
  position: V3;
  rotationY?: number;
  w?: number;
  h?: number;
  palette: string[];
  night: boolean;
}) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <RoundedBox args={[w + 0.08, h + 0.08, 0.04]} radius={0.01} castShadow>
        <meshStandardMaterial color={night ? "#2a2420" : "#2a2623"} roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, 0, 0.022]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color={night ? "#3a342e" : "#f4efe6"} roughness={0.9} />
      </mesh>
      <mesh position={[-w * 0.15, h * 0.12, 0.024]}>
        <circleGeometry args={[Math.min(w, h) * 0.26, 32]} />
        <meshBasicMaterial color={palette[0]} />
      </mesh>
      <mesh position={[w * 0.18, -h * 0.16, 0.025]}>
        <planeGeometry args={[w * 0.46, h * 0.3]} />
        <meshBasicMaterial color={palette[1]} />
      </mesh>
      <mesh position={[-w * 0.2, -h * 0.3, 0.026]} rotation={[0, 0, 0.5]}>
        <planeGeometry args={[w * 0.5, 0.03]} />
        <meshBasicMaterial color={palette[2]} />
      </mesh>
    </group>
  );
}

export function Clock({ position }: { position: V3 }) {
  const hour = useRef<THREE.Group>(null);
  const minute = useRef<THREE.Group>(null);
  useFrame(() => {
    const d = new Date();
    const m = d.getMinutes() + d.getSeconds() / 60;
    if (minute.current) minute.current.rotation.z = -(m / 60) * Math.PI * 2;
    if (hour.current) hour.current.rotation.z = -(((d.getHours() % 12) + m / 60) / 12) * Math.PI * 2;
  });
  return (
    <group position={position}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.3, 0.3, 0.05, 40]} />
        <meshStandardMaterial color="#2a2623" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0, 0.027]}>
        <circleGeometry args={[0.27, 40]} />
        <meshStandardMaterial color="#f7f3ec" roughness={0.6} />
      </mesh>
      {Array.from({ length: 12 }, (_, i) => (
        <mesh key={i} position={[Math.sin((i / 12) * Math.PI * 2) * 0.23, Math.cos((i / 12) * Math.PI * 2) * 0.23, 0.03]}>
          <boxGeometry args={[0.012, i % 3 === 0 ? 0.045 : 0.025, 0.004]} />
          <meshBasicMaterial color="#2a2623" />
        </mesh>
      ))}
      <group ref={hour} position={[0, 0, 0.035]}>
        <mesh position={[0, 0.06, 0]}>
          <boxGeometry args={[0.018, 0.14, 0.006]} />
          <meshBasicMaterial color="#2a2623" />
        </mesh>
      </group>
      <group ref={minute} position={[0, 0, 0.04]}>
        <mesh position={[0, 0.095, 0]}>
          <boxGeometry args={[0.012, 0.2, 0.006]} />
          <meshBasicMaterial color="#c45c2c" />
        </mesh>
      </group>
    </group>
  );
}

function SlatWall({ position, w = 3.2, h = 3.0, night }: { position: V3; w?: number; h?: number; night: boolean }) {
  const count = Math.floor(w / 0.13);
  return (
    <group position={position}>
      <mesh position={[0, h / 2, 0.01]} receiveShadow>
        <boxGeometry args={[w, h, 0.03]} />
        <meshStandardMaterial color={night ? "#1a1612" : "#3b2c21"} roughness={0.9} />
      </mesh>
      {Array.from({ length: count }, (_, i) => (
        <mesh key={i} position={[-w / 2 + 0.07 + i * (w / count), h / 2, 0.055]} castShadow receiveShadow>
          <boxGeometry args={[0.07, h - 0.02, 0.05]} />
          <meshStandardMaterial color={night ? "#5a4130" : i % 2 ? "#b98555" : "#a97848"} roughness={0.55} />
        </mesh>
      ))}
    </group>
  );
}

function Sideboard({ position, night }: { position: V3; night: boolean }) {
  return (
    <group position={position}>
      <RoundedBox args={[2.5, 0.62, 0.44]} radius={0.02} position={[0, 0.4, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={night ? "#2c241d" : "#4a3628"} roughness={0.55} />
      </RoundedBox>
      {[-0.42, 0.42].map((x, i) => (
        <mesh key={i} position={[x, 0.4, 0.225]}>
          <boxGeometry args={[0.02, 0.4, 0.01]} />
          <meshStandardMaterial color="#c9a45c" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      {[-1.05, 1.05].map((x, i) => (
        <mesh key={i} position={[x, 0.05, 0]}>
          <boxGeometry args={[0.06, 0.1, 0.36]} />
          <meshStandardMaterial color="#1f1a16" roughness={0.6} />
        </mesh>
      ))}
      {/* vase with stems */}
      <mesh position={[-0.75, 0.83, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, 0.26, 20]} />
        <meshStandardMaterial color="#e7dccb" roughness={0.3} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <group key={i} position={[-0.75, 0.96, 0]} rotation={[0.3 * Math.sin(i * 1.7), 0, 0.3 * Math.cos(i * 1.7)]}>
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.006, 0.006, 0.4, 5]} />
            <meshStandardMaterial color="#3d8050" />
          </mesh>
          <mesh position={[0, 0.42, 0]}>
            <sphereGeometry args={[0.035, 10, 8]} />
            <meshStandardMaterial color={["#f4c4d0", "#f7e4a0", "#ffffff"][i % 3]} roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* books stack */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0.8, 0.66 + i * 0.04, 0.0]} rotation={[0, i * 0.3, 0]} castShadow>
          <boxGeometry args={[0.3 - i * 0.03, 0.04, 0.22]} />
          <meshStandardMaterial color={BOOK_COLORS[i + 2]} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

export function Window({ x, y, z, night }: { x: number; y: number; z: number; night: boolean }) {
  const cloth = night ? "#3a322c" : "#f7efe2";
  return (
    <group>
      <mesh position={[x + 0.14, y - 0.78, z]} castShadow>
        <boxGeometry args={[0.22, 0.05, 1.9]} />
        <meshStandardMaterial color={night ? "#4a4036" : "#e9dcc6"} roughness={0.5} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[x + 0.14, y + 0.15, z + s * 1.0]} castShadow>
          <boxGeometry args={[0.07, 2.15, 0.42]} />
          <meshStandardMaterial color={cloth} roughness={1} />
        </mesh>
      ))}
      <mesh position={[x + 0.14, y + 1.0, z]}>
        <cylinderGeometry args={[0.015, 0.015, 2.5, 8]} />
        <meshStandardMaterial color="#2a2623" metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}

export function SunShafts({ x, y, z }: { x: number; y: number; z: number }) {
  const run = 3.6;
  const ang = Math.atan2(y - 0.05, run);
  const len = Math.hypot(run, y);
  return (
    <group position={[x + run / 2, y / 2, z]} rotation={[0, 0, -ang]}>
      {[
        [1.45, 0.05],
        [1.0, 0.045],
        [0.55, 0.05],
      ].map(([w, o], i) => (
        <mesh key={i}>
          <boxGeometry args={[len, 0.002, w]} />
          <meshBasicMaterial color="#fff0cc" transparent opacity={o} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function CeilingPanels({
  x0,
  x1,
  z0,
  z1,
  wallH,
  night,
}: {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  wallH: number;
  night: boolean;
}) {
  const xs = [x0 + (x1 - x0) * 0.25, x0 + (x1 - x0) * 0.5, x0 + (x1 - x0) * 0.75];
  const zs = [z0 + (z1 - z0) * 0.22, z0 + (z1 - z0) * 0.5, z0 + (z1 - z0) * 0.78];
  return (
    <group>
      {xs.map((x) =>
        zs.map((z) => (
          <group key={`${x}${z}`} position={[x, wallH - 0.03, z]}>
            <mesh>
              <boxGeometry args={[1.7, 0.05, 0.42]} />
              <meshStandardMaterial color="#e9e4dc" roughness={0.5} />
            </mesh>
            <mesh position={[0, -0.03, 0]}>
              <boxGeometry args={[1.56, 0.01, 0.3]} />
              <meshStandardMaterial
                color="#fffaf0"
                emissive="#fff1d6"
                emissiveIntensity={night ? 0.55 : 1.5}
                toneMapped={false}
              />
            </mesh>
          </group>
        ))
      )}
      {zs.map((z) => (
        <mesh key={`beam${z}`} position={[(x0 + x1) / 2, wallH - 0.12, z + (z1 - z0) * 0.14]} castShadow>
          <boxGeometry args={[x1 - x0, 0.2, 0.16]} />
          <meshStandardMaterial color={night ? "#2c241d" : "#8a6241"} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

/* ---------- Composition ---------- */

export function OfficeDecor({
  x0,
  x1,
  z0,
  z1,
  wallH,
  windowZs,
  cols,
  count,
  night,
}: {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  wallH: number;
  windowZs: number[];
  cols: number;
  count: number;
  night: boolean;
}) {
  const midX = (x0 + x1) / 2;
  const midZ = (z0 + z1) / 2;
  const backZ = z0 + 0.0;
  const rugA = night ? "#3c3028" : "#c9b8a0";
  const rugB = night ? "#5a3c2a" : "#c45c2c";
  const desks = useMemo(() => Array.from({ length: Math.max(count, 1) }, (_, i) => deskPos(i, cols)), [count, cols]);
  const loungeZ = midZ + 0.2;

  return (
    <group>
      <CeilingPanels x0={x0} x1={x1} z0={z0} z1={z1} wallH={wallH} night={night} />

      {/* rugs under each desk */}
      {desks.map((p, i) => (
        <Rug
          key={i}
          position={[p[0] + 0.45, 0.006, p[2] + 0.1]}
          size={[3.0, 3.2]}
          color={rugA}
          accent={i % 2 ? "#5d8a86" : rugB}
        />
      ))}

      {/* back wall */}
      <Bookshelf position={[x0 + 1.5, 0, backZ + 0.2]} night={night} />
      <SlatWall position={[midX + 0.1, 0, backZ + 0.0]} night={night} />
      <Clock position={[midX + 0.1, 2.85, backZ + 0.11]} />
      <Text
        position={[midX + 0.1, 1.95, backZ + 0.11]}
        fontSize={0.2}
        color={night ? "#ffd7a0" : "#fff3dc"}
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.18}
      >
        HARNESS
      </Text>
      <Sideboard position={[midX + 0.1, 0, backZ + 0.32]} night={night} />
      <LeafyPlant position={[midX - 1.85, 0, backZ + 0.55]} scale={1.15} seed={3} potColor="#c45c2c" />
      <SnakePlant position={[midX + 2.05, 0, backZ + 0.5]} scale={1.1} seed={5} />
      <CoffeeBar position={[x1 - 1.7, 0, backZ + 0.42]} night={night} />
      <WaterDispenser position={[x1 - 3.35, 0, backZ + 0.36]} />
      <Bin position={[x1 - 3.75, 0, backZ + 0.35]} color="#5d8a86" />
      <FiddlePlant position={[x0 + 0.6, 0, backZ + 0.65]} scale={1.05} seed={2} />

      {/* left wall windows */}
      {windowZs.map((z, i) => (
        <group key={i}>
          <Window x={x0} y={1.78} z={z} night={night} />
          {!night && <SunShafts x={x0 + 0.1} y={1.78} z={z} />}
          <LeafyPlant position={[x0 + 0.42, 0, z + (i % 2 ? 1.45 : -1.45)]} scale={0.85} seed={10 + i} potColor={i % 2 ? "#d9d2c5" : "#c45c2c"} />
        </group>
      ))}
      <SnakePlant position={[x0 + 0.42, 0, midZ + 0.0]} scale={0.95} seed={8} />

      {/* lounge on right wall */}
      <Rug position={[x1 - 1.75, 0.007, loungeZ]} size={[2.9, 2.9]} color={night ? "#3a3026" : "#e4d6bf"} accent={night ? "#5a3c2a" : "#d98f52"} round />
      <Sofa position={[x1 - 0.62, 0, loungeZ]} rotationY={-Math.PI / 2} night={night} />
      <CoffeeTable position={[x1 - 1.95, 0, loungeZ]} night={night} />
      <FloorLamp position={[x1 - 0.5, 0, loungeZ + 1.45]} night={night} />
      <FiddlePlant position={[x1 - 0.6, 0, loungeZ - 1.6]} scale={1.15} seed={7} />
      <WallArt position={[x1 - 0.02, 1.9, loungeZ - 0.5]} rotationY={-Math.PI / 2} palette={["#c45c2c", "#2f5a7a", "#e0b45c"]} night={night} />
      <WallArt position={[x1 - 0.02, 1.9, loungeZ + 0.65]} rotationY={-Math.PI / 2} w={0.7} h={0.9} palette={["#5d8a86", "#e0b45c", "#7a3a4a"]} night={night} />
      <Bin position={[x1 - 0.5, 0, loungeZ - 1.05]} />

      {/* front corners */}
      <LeafyPlant position={[x1 - 0.65, 0, z1 - 0.6]} scale={1.1} seed={4} potColor="#c45c2c" />
      <SnakePlant position={[x0 + 0.6, 0, z1 - 0.6]} scale={1.05} seed={9} potColor="#d9d2c5" />
    </group>
  );
}
