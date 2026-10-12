"use client";

import { Suspense, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, ThreeEvent, useLoader } from "@react-three/fiber";
import { ContactShadows, OrbitControls, useCursor } from "@react-three/drei";
import * as THREE from "three";
import { CortexShare } from "@/lib/brainShare";
import { WebGLFallback } from "../WorkerCanvas";

export type { CortexShare };

const SPECIMEN_URL = "/brain/specimen.bin";

function hexColor(hex: string) {
  try {
    return new THREE.Color(hex);
  } catch {
    return new THREE.Color("#d46a3a");
  }
}

function stainFromPigment(hex: string) {
  const color = hexColor(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  hsl.s = THREE.MathUtils.clamp(hsl.s * 0.48, 0.18, 0.42);
  hsl.l = THREE.MathUtils.clamp(hsl.l * 0.48 + 0.24, 0.4, 0.52);
  color.setHSL(hsl.h, hsl.s, hsl.l);
  return color;
}

type Seed = { dir: THREE.Vector3; index: number; color: THREE.Color; weight: number };

function makeSeeds(shares: CortexShare[]): Seed[] {
  if (!shares.length) return [];
  const total = shares.reduce((sum, row) => sum + row.weight, 0);
  const extra = 28;
  const counts = shares.map((row) => 1 + Math.round((extra * row.weight) / total));
  let sum = counts.reduce((a, b) => a + b, 0);
  const top = shares.reduce((best, row, i) => (row.weight > shares[best].weight ? i : best), 0);
  while (sum > extra + shares.length) {
    const i = counts.findIndex((n, idx) => n > 1 && idx !== top);
    if (i < 0) break;
    counts[i] -= 1;
    sum -= 1;
  }
  const seeds: Seed[] = [];
  let k = 0;
  const n = Math.max(sum, 1);
  shares.forEach((row, index) => {
    for (let i = 0; i < counts[index]; i++) {
      const t = (k + 0.5) / n;
      const y = 1 - 2 * t;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = k * 2.399963;
      seeds.push({
        dir: new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).normalize(),
        index,
        color: stainFromPigment(row.pigment),
        weight: row.weight,
      });
      k += 1;
    }
  });
  return seeds;
}

function seedScore(dir: THREE.Vector3, seed: Seed) {
  return dir.distanceToSquared(seed.dir) / Math.pow(Math.max(seed.weight, 0.08), 1.12);
}

function twoNearest(dir: THREE.Vector3, seeds: Seed[]) {
  let b1 = Infinity;
  let b2 = Infinity;
  let h1 = seeds[0];
  let h2 = seeds[0];
  for (const seed of seeds) {
    const d = seedScore(dir, seed);
    if (d < b1) {
      b2 = b1;
      h2 = h1;
      b1 = d;
      h1 = seed;
    } else if (d < b2) {
      b2 = d;
      h2 = seed;
    }
  }
  return { h1, h2, b1, b2 };
}

const FLESH = new THREE.Color("#d7b0a0");
const SULCUS = new THREE.Color("#6a4a40");

function parseSpecimen(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "BRN1") throw new Error("bad specimen");
  const verts = view.getUint32(4, true);
  const indexCount = view.getUint32(8, true);
  let off = 16;
  const pos = new Float32Array(buffer.slice(off, off + verts * 12));
  off += verts * 12;
  const nrm = new Float32Array(buffer.slice(off, off + verts * 12));
  off += verts * 12;
  const idx = new Uint32Array(buffer.slice(off, off + indexCount * 4));
  const orig = new Float32Array(verts * 3);
  const crease = new Float32Array(verts);
  for (let i = 0; i < verts; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const len = Math.hypot(x, y, z) || 1;
    orig[i * 3] = x / len;
    orig[i * 3 + 1] = y / len;
    orig[i * 3 + 2] = z / len;
    const ndot = (nrm[i * 3] * orig[i * 3] + nrm[i * 3 + 1] * orig[i * 3 + 1] + nrm[i * 3 + 2] * orig[i * 3 + 2] + 1) * 0.5;
    crease[i] = THREE.MathUtils.clamp(1 - ndot, 0, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute("orig", new THREE.BufferAttribute(orig, 3));
  geo.setAttribute("crease", new THREE.BufferAttribute(crease, 1));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

class SpecimenLoader extends THREE.Loader {
  load(
    url: string,
    onLoad: (geo: THREE.BufferGeometry) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (event: unknown) => void
  ) {
    const file = new THREE.FileLoader(this.manager);
    file.setResponseType("arraybuffer");
    file.load(
      url,
      (data) => {
        try {
          onLoad(parseSpecimen(data as ArrayBuffer));
        } catch (err) {
          onError?.(err);
        }
      },
      onProgress,
      onError
    );
  }
}

function paintCortex(
  geo: THREE.BufferGeometry,
  shares: CortexShare[],
  seeds: Seed[],
  selectedId?: string | null,
  hoveredId?: string | null
) {
  const pos = geo.attributes.position;
  const orig = geo.attributes.orig as THREE.BufferAttribute;
  const creaseAttr = geo.attributes.crease as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const owner = new Float32Array(pos.count);
  const dir = new THREE.Vector3();
  const mixed = new THREE.Color();
  const focusId = hoveredId || selectedId || null;
  if (!seeds.length) {
    for (let i = 0; i < pos.count; i++) {
      mixed.copy(FLESH).lerp(SULCUS, creaseAttr.getX(i) * 0.55);
      colors[i * 3] = mixed.r;
      colors[i * 3 + 1] = mixed.g;
      colors[i * 3 + 2] = mixed.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("owner", new THREE.BufferAttribute(owner, 1));
    return;
  }
  for (let i = 0; i < pos.count; i++) {
    dir.set(orig.getX(i), orig.getY(i), orig.getZ(i)).normalize();
    const { h1, h2, b1, b2 } = twoNearest(dir, seeds);
    const share = shares[h1.index];
    const crease = creaseAttr.getX(i);
    const edge = b1 / Math.max(b1 + b2, 1e-6);
    const hold = THREE.MathUtils.smoothstep(0.58, 0.36, edge);
    const on = Boolean(focusId) && share?.id === focusId;
    const neighborOn = Boolean(focusId) && shares[h2.index]?.id === focusId;
    if (on && share) {
      const amt = neighborOn ? 1 : hold;
      mixed.copy(FLESH).lerp(hexColor(share.pigment), 0.22 + 0.62 * amt);
      mixed.lerp(SULCUS, crease * 0.28);
    } else if (focusId) {
      mixed.copy(FLESH).lerp(h1.color, 0.05 * hold);
      mixed.lerp(SULCUS, crease * 0.48);
    } else {
      mixed.copy(FLESH).lerp(h1.color, 0.18 * hold);
      mixed.lerp(h2.color, (1 - hold) * 0.1);
      mixed.lerp(SULCUS, crease * 0.52);
    }
    colors[i * 3] = mixed.r;
    colors[i * 3 + 1] = mixed.g;
    colors[i * 3 + 2] = mixed.b;
    owner[i] = h1.index;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("owner", new THREE.BufferAttribute(owner, 1));
}

function shareAtFace(geo: THREE.BufferGeometry, vert: number | undefined, shares: CortexShare[]) {
  if (vert == null) return null;
  const attr = geo.getAttribute("owner") as THREE.BufferAttribute | undefined;
  if (!attr) return null;
  return shares[Math.round(attr.getX(vert))] || null;
}

function Cortex({
  shares,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
}: {
  shares: CortexShare[];
  selectedId?: string | null;
  hoveredId?: string | null;
  onSelect?: (id: string) => void;
  onHover?: (share: CortexShare | null, clientX: number, clientY: number) => void;
}) {
  const geo = useLoader(SpecimenLoader, SPECIMEN_URL) as THREE.BufferGeometry;
  const seeds = useMemo(() => makeSeeds(shares), [shares]);
  const signature = `${shares.map((row) => `${row.id}:${Math.round(row.weight * 10)}:${row.pigment}`).join("|")}|${selectedId || ""}|${hoveredId || ""}`;
  useLayoutEffect(() => {
    paintCortex(geo, shares, seeds, selectedId, hoveredId);
  }, [geo, seeds, signature, shares, selectedId, hoveredId]);
  useCursor(Boolean(hoveredId));
  function pickShare(e: ThreeEvent<PointerEvent>) {
    return shareAtFace(geo, e.face?.a, shares);
  }
  return (
    <mesh
      geometry={geo}
      castShadow
      receiveShadow
      onPointerDown={(e) => {
        e.stopPropagation();
        const share = pickShare(e);
        if (share) onSelect?.(share.id);
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
        const share = pickShare(e);
        onHover?.(share, e.nativeEvent.clientX, e.nativeEvent.clientY);
      }}
      onPointerOut={() => onHover?.(null, 0, 0)}
    >
      <meshPhysicalMaterial
        vertexColors
        roughness={0.48}
        metalness={0.02}
        sheen={0.42}
        sheenRoughness={0.48}
        sheenColor="#f0d6c8"
        clearcoat={0.08}
        clearcoatRoughness={0.65}
      />
    </mesh>
  );
}

function SpecimenScene({
  shares,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
}: {
  shares: CortexShare[];
  selectedId?: string | null;
  hoveredId?: string | null;
  onSelect?: (id: string) => void;
  onHover?: (share: CortexShare | null, clientX: number, clientY: number) => void;
}) {
  return (
    <>
      <color attach="background" args={["#d4c6b4"]} />
      <hemisphereLight args={["#fff7ee", "#6e5a4c", 0.62]} />
      <directionalLight
        position={[2.6, 4.8, 3.4]}
        intensity={1.55}
        color="#fff4e8"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-near={0.5}
        shadow-camera-far={16}
        shadow-camera-left={-2.6}
        shadow-camera-right={2.6}
        shadow-camera-top={2.6}
        shadow-camera-bottom={-2.6}
      />
      <directionalLight position={[-2.8, 1.8, -1.4]} intensity={0.42} color="#cbb09a" />
      <directionalLight position={[0.4, -0.2, 2.8]} intensity={0.22} color="#f2e2d2" />
      <group position={[0, 0.08, 0]}>
        <Suspense fallback={null}>
          <Cortex
            shares={shares}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onSelect={onSelect}
            onHover={onHover}
          />
        </Suspense>
      </group>
      <mesh position={[0, -0.86, 0]} receiveShadow>
        <cylinderGeometry args={[0.88, 0.96, 0.07, 64]} />
        <meshStandardMaterial color="#e8dccb" roughness={0.8} metalness={0.02} />
      </mesh>
      <ContactShadows position={[0, -0.9, 0]} opacity={0.2} scale={5} blur={1.3} far={2} />
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        autoRotate={!hoveredId}
        autoRotateSpeed={0.16}
        minDistance={3.2}
        maxDistance={6.8}
        minPolarAngle={0.7}
        maxPolarAngle={1.35}
        target={[0, 0.08, 0]}
      />
    </>
  );
}

export function BrainSpecimen({
  shares,
  selectedId,
  onSelect,
  onRegion,
  className,
}: {
  shares: CortexShare[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onRegion?: (id: string | null) => void;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<CortexShare | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const total = shares.reduce((sum, row) => sum + row.weight, 0) || 1;
  const pct = hovered ? Math.round((hovered.weight / total) * 100) : 0;

  function onHover(share: CortexShare | null, clientX: number, clientY: number) {
    setHovered(share);
    onRegion?.(share?.id || null);
    if (!share || !wrap.current) {
      setTip(null);
      return;
    }
    const rect = wrap.current.getBoundingClientRect();
    const x = THREE.MathUtils.clamp(clientX - rect.left + 14, 12, rect.width - 180);
    const y = THREE.MathUtils.clamp(clientY - rect.top + 14, 12, rect.height - 88);
    setTip({ x, y });
  }

  return (
    <WebGLFallback
      fallback={
        <div className={`${className || ""} flex items-end bg-[#d4c6b4] px-5 py-4 text-sm text-[var(--ink-soft)]`}>
          Specimen needs WebGL. The cards still update.
        </div>
      }
    >
      <div ref={wrap} className={`relative min-h-0 w-full ${className || "h-full"}`}>
        <Canvas
          className="absolute inset-0 h-full w-full"
          shadows
          camera={{ position: [1.85, 1.05, 3.35], fov: 30, near: 0.2, far: 40 }}
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, powerPreference: "high-performance" }}
        >
          <SpecimenScene
            shares={shares}
            selectedId={selectedId}
            hoveredId={hovered?.id || null}
            onSelect={onSelect}
            onHover={onHover}
          />
        </Canvas>
        {hovered && tip && (
          <div
            className="pointer-events-none absolute z-10 w-[10.5rem] rounded-[18px] bg-[#fffdf8] px-3 py-2.5 shadow-[var(--shadow-3)]"
            style={{ left: tip.x, top: tip.y }}
          >
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-soft)]">This fold</p>
            <p className="display mt-0.5 truncate text-[1.35rem] leading-none">{hovered.name}</p>
            <p className="mt-1 text-sm tabular-nums text-[var(--ink)]">
              {pct}% of the cortex
            </p>
            <p className="truncate text-[11px] text-[var(--ink-soft)]">
              {hovered.live ? hovered.caption || "Working this region" : "Holds this region"}
            </p>
          </div>
        )}
      </div>
    </WebGLFallback>
  );
}
