"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, RoundedBox, Text } from "@react-three/drei";
import * as THREE from "three";
import {
  Activity,
  Agent,
  API_URL,
  Artifact,
  Chain,
  LiveState,
  PinCard,
} from "@/lib/types";
import { Station, WebGLFallback, FreeOrbit } from "./WorkerCanvas";

const GAP_X = 4.35;
const GAP_Z = 4.65;

function busy(status?: string) {
  return ["queued", "thinking", "tool"].includes(status || "");
}

function colsFor(n: number) {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

function deskSlots(count: number) {
  const cols = colsFor(Math.max(count, 1));
  const rows = Math.max(1, Math.ceil(Math.max(count, 1) / cols));
  return { cols, rows };
}

function deskPos(index: number, cols: number): [number, number, number] {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return [col * GAP_X, 0, 2.55 + row * GAP_Z];
}

function isPicture(file: Artifact) {
  const mime = file.mime || "";
  if (mime.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name || "");
}

function canvasTexture(paint: (ctx: CanvasRenderingContext2D, size: number) => void, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) paint(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function useStudioMaps(night: boolean) {
  return useMemo(() => {
    const floor = canvasTexture((ctx, s) => {
      ctx.fillStyle = night ? "#2a241f" : "#dcc9ae";
      ctx.fillRect(0, 0, s, s);
      const plank = s / 8;
      for (let x = 0; x < s; x += plank) {
        ctx.fillStyle = night ? "rgba(0,0,0,0.16)" : "rgba(92,58,32,0.07)";
        ctx.fillRect(x, 0, plank - 3, s);
        ctx.strokeStyle = night ? "rgba(0,0,0,0.28)" : "rgba(70,42,22,0.14)";
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, s);
        ctx.stroke();
      }
      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = night ? "rgba(0,0,0,0.08)" : "rgba(60,35,18,0.045)";
        ctx.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 48, 1);
      }
    });
    floor.wrapS = floor.wrapT = THREE.RepeatWrapping;
    floor.repeat.set(12, 12);

    const wall = canvasTexture((ctx, s) => {
      ctx.fillStyle = night ? "#322c27" : "#f3ece3";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 400; i++) {
        const n = night ? 20 : 238;
        ctx.fillStyle = `rgba(${n},${n - 6},${n - 14},${0.04 + Math.random() * 0.05})`;
        ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
    });
    wall.wrapS = wall.wrapT = THREE.RepeatWrapping;
    wall.repeat.set(5, 2);

    const sky = canvasTexture((ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      if (night) {
        g.addColorStop(0, "#0b1020");
        g.addColorStop(0.55, "#1a2744");
        g.addColorStop(1, "#2a1c14");
      } else {
        g.addColorStop(0, "#8ec4e8");
        g.addColorStop(0.45, "#c5dcea");
        g.addColorStop(1, "#f0e4cc");
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = night ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.55)";
      for (let i = 0; i < (night ? 40 : 6); i++) {
        ctx.beginPath();
        ctx.arc(Math.random() * s, Math.random() * s * 0.45, night ? 0.7 : 18, 0, Math.PI * 2);
        ctx.fill();
      }
    }, 128);

    return { floor, wall, sky };
  }, [night]);
}

function Exposure({ night }: { night: boolean }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.toneMappingExposure = night ? 0.62 : 0.98;
    gl.shadowMap.autoUpdate = true;
  }, [gl, night]);
  return null;
}

function WindowUnit({
  position,
  night,
  sky,
}: {
  position: [number, number, number];
  night: boolean;
  sky: THREE.Texture;
}) {
  const trim = night ? "#4a4036" : "#cbb79a";
  const pane = 1.58;
  const tall = 1.42;
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[0.1, tall + 0.22, pane + 0.22]} />
        <meshStandardMaterial color={trim} roughness={0.48} />
      </mesh>
      <mesh position={[0.06, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[pane, tall]} />
        <meshBasicMaterial map={sky} toneMapped={false} />
      </mesh>
      <mesh position={[0.055, 0, 0]}>
        <boxGeometry args={[0.04, tall, 0.035]} />
        <meshStandardMaterial color={trim} roughness={0.5} />
      </mesh>
      <mesh position={[0.055, 0, 0]}>
        <boxGeometry args={[0.04, 0.035, pane]} />
        <meshStandardMaterial color={trim} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Pendant({ position, night }: { position: [number, number, number]; night: boolean }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.006, 0.006, 0.7, 8]} />
        <meshStandardMaterial color="#2a2623" metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh castShadow>
        <cylinderGeometry args={[0.18, 0.26, 0.14, 24]} />
        <meshStandardMaterial
          color="#f3ece3"
          roughness={0.35}
          emissive="#fff4dc"
          emissiveIntensity={night ? 0.25 : 0.7}
        />
      </mesh>
      <pointLight
        position={[0, -0.08, 0]}
        intensity={night ? 0.38 : 1.05}
        distance={6.5}
        decay={2}
        color="#ffe2b8"
      />
    </group>
  );
}

function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.16, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.13, 0.32, 16]} />
        <meshStandardMaterial color="#c45c2c" roughness={0.48} />
      </mesh>
      <mesh position={[0, 0.58, 0]} castShadow>
        <icosahedronGeometry args={[0.34, 0]} />
        <meshStandardMaterial color="#3a6a4c" roughness={0.82} />
      </mesh>
      <mesh position={[0.18, 0.72, 0.06]} castShadow>
        <icosahedronGeometry args={[0.2, 0]} />
        <meshStandardMaterial color="#4f825d" roughness={0.82} />
      </mesh>
      <mesh position={[-0.14, 0.7, -0.1]} castShadow>
        <icosahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial color="#2f5a40" roughness={0.82} />
      </mesh>
    </group>
  );
}

function hallShell(width: number, depth: number) {
  const thick = 0.22;
  const wallH = 4.7;
  const x0 = -2.35;
  const x1 = width + 1.2;
  const z0 = -1.08;
  const z1 = depth + 1.4;
  const midX = (x0 + x1) / 2;
  const midZ = (z0 + z1) / 2;
  const innerW = x1 - x0;
  const innerD = z1 - z0;
  return { thick, wallH, x0, x1, z0, z1, midX, midZ, innerW, innerD };
}

function Hall({
  width,
  depth,
  night,
}: {
  width: number;
  depth: number;
  night: boolean;
}) {
  const maps = useStudioMaps(night);
  const { thick, wallH, x0, x1, z0, z1, midX, midZ, innerW, innerD } = hallShell(width, depth);
  const trim = night ? "#4a4036" : "#cbb79a";
  const plaster = night ? "#2a2420" : "#f4eee6";
  const windowZs = [z0 + 2.15, midZ, z1 - 2.35];

  useEffect(() => {
    return () => {
      maps.floor.dispose();
      maps.wall.dispose();
      maps.sky.dispose();
    };
  }, [maps]);

  return (
    <group>
      <mesh position={[x0 - 14, 4.2, midZ]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[90, 48]} />
        <meshBasicMaterial map={maps.sky} fog={false} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[midX, 0, midZ]} receiveShadow>
        <planeGeometry args={[innerW + 8, innerD + 8]} />
        <meshStandardMaterial map={maps.floor} roughness={0.86} metalness={0.03} />
      </mesh>

      <mesh position={[midX, wallH / 2, z0 - thick / 2]} receiveShadow>
        <boxGeometry args={[innerW + thick * 2, wallH, thick]} />
        <meshStandardMaterial map={maps.wall} roughness={0.93} />
      </mesh>
      <mesh position={[x0 - thick / 2, wallH / 2, midZ]} receiveShadow>
        <boxGeometry args={[thick, wallH, innerD]} />
        <meshStandardMaterial map={maps.wall} roughness={0.93} />
      </mesh>
      <mesh position={[x1 + thick / 2, wallH / 2, midZ]} receiveShadow>
        <boxGeometry args={[thick, wallH, innerD]} />
        <meshStandardMaterial map={maps.wall} roughness={0.93} />
      </mesh>

      <mesh position={[midX, wallH + 0.1, midZ - 0.08]} receiveShadow>
        <boxGeometry args={[innerW + thick * 2 + 0.08, 0.2, innerD + thick]} />
        <meshStandardMaterial color={plaster} roughness={0.96} />
      </mesh>
      <mesh position={[midX, wallH - 0.07, z1]}>
        <boxGeometry args={[innerW + 0.35, 0.22, 0.2]} />
        <meshStandardMaterial color={trim} roughness={0.52} />
      </mesh>
      <mesh position={[midX, wallH - 0.05, z0 + 0.08]}>
        <boxGeometry args={[innerW - 0.1, 0.1, 0.08]} />
        <meshStandardMaterial color={trim} roughness={0.52} />
      </mesh>
      <mesh position={[x0 + 0.08, wallH - 0.05, midZ]}>
        <boxGeometry args={[0.08, 0.1, innerD - 0.1]} />
        <meshStandardMaterial color={trim} roughness={0.52} />
      </mesh>
      <mesh position={[x1 - 0.08, wallH - 0.05, midZ]}>
        <boxGeometry args={[0.08, 0.1, innerD - 0.1]} />
        <meshStandardMaterial color={trim} roughness={0.52} />
      </mesh>

      <mesh position={[midX, 0.075, z0 + 0.06]}>
        <boxGeometry args={[innerW - 0.08, 0.15, 0.08]} />
        <meshStandardMaterial color={trim} roughness={0.55} />
      </mesh>
      <mesh position={[x0 + 0.06, 0.075, midZ]}>
        <boxGeometry args={[0.08, 0.15, innerD - 0.12]} />
        <meshStandardMaterial color={trim} roughness={0.55} />
      </mesh>
      <mesh position={[x1 - 0.06, 0.075, midZ]}>
        <boxGeometry args={[0.08, 0.15, innerD - 0.12]} />
        <meshStandardMaterial color={trim} roughness={0.55} />
      </mesh>

      {windowZs.map((z, i) => (
        <WindowUnit key={i} position={[x0 + 0.02, 1.78, z]} night={night} sky={maps.sky} />
      ))}

      {[midX - innerW * 0.28, midX, midX + innerW * 0.28].map((x, i) => (
        <group key={`can-${i}`} position={[x, wallH - 0.02, midZ + (i === 1 ? 0.8 : i === 0 ? -1.1 : 1.4)]}>
          <mesh>
            <cylinderGeometry args={[0.16, 0.16, 0.05, 20]} />
            <meshStandardMaterial
              color={night ? "#3a322c" : "#e7dccb"}
              emissive="#fff1d6"
              emissiveIntensity={night ? 0.12 : 0.28}
              roughness={0.4}
            />
          </mesh>
          <pointLight intensity={night ? 0.35 : 0.85} distance={9} decay={2} color="#ffe6c4" />
        </group>
      ))}

      <Pendant position={[midX - 1.35, wallH - 1.15, midZ - 0.55]} night={night} />
      <Pendant position={[midX + 1.55, wallH - 1.15, midZ + 1.35]} night={night} />
      {depth > 12 && <Pendant position={[midX, wallH - 1.15, midZ + 3.6]} night={night} />}

      <Plant position={[x0 + 0.85, 0, z0 + 0.85]} />
      <Plant position={[x1 - 0.7, 0, z1 - 0.55]} scale={1.12} />
      <Plant position={[x0 + 0.9, 0, z1 - 0.5]} scale={0.85} />

      <RoundedBox args={[0.3, wallH, 0.3]} radius={0.03} position={[x0 + 0.12, wallH / 2, z0 + 0.12]}>
        <meshStandardMaterial color={night ? "#3a332c" : "#e7d7c2"} roughness={0.8} />
      </RoundedBox>
      <RoundedBox args={[0.3, wallH, 0.3]} radius={0.03} position={[x1 - 0.12, wallH / 2, z0 + 0.12]}>
        <meshStandardMaterial color={night ? "#3a332c" : "#e7d7c2"} roughness={0.8} />
      </RoundedBox>
    </group>
  );
}

function NamePlaque({ name, night }: { name: string; night: boolean }) {
  return (
    <group position={[1.12, 0.798, 0.72]}>
      <RoundedBox args={[0.44, 0.07, 0.03]} radius={0.008} castShadow>
        <meshStandardMaterial color={night ? "#3a322c" : "#6b4a32"} roughness={0.42} />
      </RoundedBox>
      <Text
        position={[0, 0, 0.018]}
        fontSize={0.046}
        color={night ? "#fff6ea" : "#f4efe6"}
        anchorX="center"
        anchorY="middle"
        maxWidth={0.4}
      >
        {name}
      </Text>
    </group>
  );
}

function WorkGlow({ color, on }: { color: string; on: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const mat = ref.current.material as THREE.MeshBasicMaterial | THREE.MeshBasicMaterial[];
    const one = Array.isArray(mat) ? mat[0] : mat;
    if (!one) return;
    one.opacity = on ? 0.18 + Math.sin(clock.elapsedTime * 2.1) * 0.05 : 0;
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0.58, 0.028, 0.1]}>
      <circleGeometry args={[1.05, 40]} />
      <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function SelectRing({ color }: { color: string }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.58, 0.025, 0.1]}>
      <ringGeometry args={[1.18, 1.28, 48]} />
      <meshBasicMaterial color={color} transparent opacity={0.55} depthWrite={false} />
    </mesh>
  );
}

function DeskLamp({ on }: { on: boolean }) {
  return (
    <group position={[1.28, 0.76, -0.68]}>
      <mesh position={[0, 0.015, 0]} castShadow>
        <cylinderGeometry args={[0.04, 0.045, 0.03, 12]} />
        <meshStandardMaterial color="#2a2623" metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.012, 0.014, 0.36, 8]} />
        <meshStandardMaterial color="#2a2623" metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh position={[-0.06, 0.4, 0.08]} rotation={[0.7, 0.4, 0]} castShadow>
        <coneGeometry args={[0.11, 0.14, 20, 1, true]} />
        <meshStandardMaterial color="#3a342e" roughness={0.4} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[-0.08, 0.34, 0.1]}>
        <sphereGeometry args={[0.028, 10, 10]} />
        <meshStandardMaterial
          color="#fff4dc"
          emissive="#ffd7a0"
          emissiveIntensity={on ? 1.2 : 0.05}
        />
      </mesh>
      {on && <pointLight position={[-0.1, 0.3, 0.12]} distance={3.2} intensity={1.8} color="#ffc27a" />}
    </group>
  );
}

function Parcel({
  from,
  to,
}: {
  from: [number, number, number];
  to: [number, number, number];
}) {
  const ref = useRef<THREE.Group>(null);
  const a = useMemo(() => new THREE.Vector3(...from), [from]);
  const b = useMemo(() => new THREE.Vector3(...to), [to]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = Math.sin(clock.elapsedTime * 0.75) * 0.5 + 0.5;
    ref.current.position.lerpVectors(a, b, t);
    ref.current.position.y = 1.22 + Math.sin(clock.elapsedTime * 2.8) * 0.08;
    ref.current.rotation.y = clock.elapsedTime * 0.55;
  });
  return (
    <group ref={ref}>
      <mesh castShadow>
        <boxGeometry args={[0.26, 0.045, 0.34]} />
        <meshStandardMaterial color="#c45c2c" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.035, 0]} castShadow>
        <boxGeometry args={[0.2, 0.025, 0.26]} />
        <meshStandardMaterial color="#f4efe6" roughness={0.68} />
      </mesh>
    </group>
  );
}

function WallPhoto({ url, w, h }: { url: string; w: number; h: number }) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (t) => {
        if (!alive) {
          t.dispose();
          return;
        }
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        setTex(t);
      },
      undefined,
      () => {
        if (alive) setTex(null);
      }
    );
    return () => {
      alive = false;
      setTex((prev) => {
        prev?.dispose();
        return null;
      });
    };
  }, [url]);
  return (
    <mesh>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex || undefined} color={tex ? "#ffffff" : "#e7d7c2"} />
    </mesh>
  );
}

function Frame({
  position,
  night,
  photo,
  src,
  paper,
  onOpen,
}: {
  position: [number, number, number];
  night: boolean;
  photo?: boolean;
  src?: string;
  paper?: string;
  onOpen?: () => void;
}) {
  return (
    <group
      position={position}
      onClick={(e) => {
        if (!onOpen) return;
        e.stopPropagation();
        onOpen();
      }}
      onPointerOver={(e) => {
        if (!onOpen) return;
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "auto";
      }}
    >
      <RoundedBox args={[1.22, 0.98, 0.07]} radius={0.02} castShadow>
        <meshStandardMaterial color={night ? "#3f372f" : "#6b4a32"} roughness={0.42} />
      </RoundedBox>
      <mesh position={[0, 0.01, 0.038]}>
        <planeGeometry args={[1.08, 0.84]} />
        <meshStandardMaterial color={night ? "#2c2620" : "#f4efe6"} roughness={0.9} />
      </mesh>
      <group position={[0, 0.01, 0.042]}>
        {photo && src ? (
          <WallPhoto url={src} w={1.02} h={0.78} />
        ) : (
          <mesh>
            <planeGeometry args={[1.02, 0.78]} />
            <meshBasicMaterial color={paper || "#efe4d2"} />
          </mesh>
        )}
      </group>
      <mesh position={[0, 0.58, 0.12]} rotation={[0.15, 0, 0]}>
        <boxGeometry args={[0.28, 0.03, 0.08]} />
        <meshStandardMaterial
          color="#2a2623"
          emissive="#ffd7a0"
          emissiveIntensity={night ? 0.35 : 0.85}
          roughness={0.4}
        />
      </mesh>
    </group>
  );
}

function ShowroomWall({
  pins,
  width,
  night,
  onOpen,
}: {
  pins: PinCard[];
  width: number;
  night: boolean;
  onOpen: (pin: PinCard) => void;
}) {
  const cards = pins.filter((p) => p.artifact).slice(0, 7);
  const cx = width / 2 - GAP_X / 2;
  const frames = cards.length ? cards : [null, null, null];
  return (
    <group position={[cx, 0, -1.06]}>
      <mesh position={[0, 0.42, 0.12]} castShadow>
        <boxGeometry args={[Math.min(width + 2.4, 11), 0.08, 0.28]} />
        <meshStandardMaterial color={night ? "#3a322c" : "#6b4a32"} roughness={0.48} />
      </mesh>
      <spotLight
        position={[0, 2.55, 1.35]}
        rotation={[-0.85, 0, 0]}
        angle={0.62}
        penumbra={0.85}
        intensity={night ? 2.4 : 4.2}
        color="#ffe6c4"
        distance={8}
        castShadow={false}
      />
      {frames.map((pin, i) => {
        const n = frames.length;
        const spread = Math.min(width + 1.6, Math.max(n * 1.42, 2.4));
        const x = n === 1 ? 0 : -spread / 2 + (i / Math.max(n - 1, 1)) * spread;
        if (!pin) {
          return <Frame key={`empty-${i}`} position={[x, 1.52, 0.08]} night={night} />;
        }
        const art = pin.artifact!;
        return (
          <Frame
            key={pin.id}
            position={[x, 1.52, 0.08]}
            night={night}
            photo={isPicture(art)}
            src={`${API_URL}/api/artifacts/${art.id}/file`}
            paper={art.kind === "pack" ? "#f2e6d4" : "#efe8dc"}
            onOpen={() => onOpen(pin)}
          />
        );
      })}
    </group>
  );
}

function crewRelay(
  agents: Agent[],
  live: Record<string, LiveState>,
  chains: Record<string, Chain>
) {
  for (const agent of agents) {
    const job = live[agent.id]?.job;
    if (!job?.chain_id) continue;
    const chain = chains[job.chain_id];
    if (!chain?.steps?.length) continue;
    const current =
      chain.steps.find((s) => s.id === job.chain_step_id) ||
      chain.steps.find((s) => s.status === "running" || s.status === "working");
    if (!current) continue;
    const prev = chain.steps.find((s) => s.seq === current.seq - 1);
    return {
      fromId: prev?.agent_id || current.agent_id || agent.id,
      toId: current.agent_id || agent.id,
    };
  }
  return null;
}

function OfficeScene({
  agents,
  live,
  selectedId,
  chains,
  showroom,
  night,
  onSelect,
  onPreview,
}: {
  agents: Agent[];
  live: Record<string, LiveState>;
  selectedId: string | null;
  chains: Record<string, Chain>;
  showroom: PinCard[];
  night: boolean;
  onSelect: (id: string) => void;
  onPreview: (jobId: string, file: Artifact) => void;
}) {
  const { cols, rows } = deskSlots(agents.length);
  const width = Math.max(cols * GAP_X, 8.2);
  const depth = Math.max(rows * GAP_Z + 3.4, 10.5);
  const spots = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    agents.forEach((agent, i) => map.set(agent.id, deskPos(i, cols)));
    return map;
  }, [agents, cols]);
  const relay = crewRelay(agents, live, chains);
  const from = relay ? spots.get(relay.fromId) : null;
  const to = relay ? spots.get(relay.toId) : null;
  const cx = width / 2 - GAP_X / 2;

  return (
    <>
      <color attach="background" args={[night ? "#12100e" : "#d9cbb8"]} />
      <fog attach="fog" args={[night ? "#12100e" : "#d9cbb8", 36, 120]} />
      <Exposure night={night} />
      <ambientLight intensity={night ? 0.12 : 0.38} />
      <hemisphereLight args={night ? ["#3a2e24", "#0c0a09", 0.28] : ["#fff6ea", "#c4b49a", 0.48]} />
      <directionalLight
        position={[-9.5, 3.6, depth / 2]}
        intensity={night ? 0.18 : 1.15}
        color={night ? "#8aa0c8" : "#fff1d4"}
        castShadow={!night}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.00025}
        shadow-normalBias={0.035}
        shadow-camera-near={1}
        shadow-camera-far={48}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      {!night && <directionalLight position={[6, 3.2, 8]} intensity={0.22} color="#ffd9a8" />}
      <Hall width={width} depth={depth} night={night} />
      <ShowroomWall
        pins={showroom}
        width={width}
        night={night}
        onOpen={(pin) => {
          onSelect(pin.agent_id);
          if (pin.artifact) onPreview(pin.job_id, pin.artifact);
        }}
      />
      {agents.map((agent, i) => {
        const pos = deskPos(i, cols);
        const job = live[agent.id]?.job;
        const liveNow = busy(job?.status);
        const activity = (job?.activity || "idle") as Activity;
        const feed = (live[agent.id]?.tokens || job?.output || "").trim();
        const selected = selectedId === agent.id;
        return (
          <group
            key={agent.id}
            position={pos}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(agent.id);
            }}
            onPointerOver={() => {
              document.body.style.cursor = "pointer";
            }}
            onPointerOut={() => {
              document.body.style.cursor = "auto";
            }}
          >
            <WorkGlow color={agent.pigment} on={liveNow} />
            {selected && <SelectRing color={agent.pigment} />}
            <group scale={0.94}>
              <Station agent={agent} activity={activity} feed={feed} room={false} />
              <NamePlaque name={agent.name} night={night} />
              <DeskLamp on={night ? liveNow : false} />
            </group>
          </group>
        );
      })}
      {relay && from && to && (
        <Parcel
          from={[from[0] + 0.7, 1.15, from[2] + 0.15]}
          to={[to[0] + 0.7, 1.15, to[2] + 0.15]}
        />
      )}
      <ContactShadows
        frames={1}
        position={[cx, 0.012, depth / 2]}
        opacity={night ? 0.42 : 0.28}
        scale={32}
        blur={2.6}
        far={9}
      />
      <FreeOrbit lookAt={[cx, 0.9, depth * 0.42]} minDistance={0.8} maxDistance={72} />
    </>
  );
}

export function OfficeCanvas({
  agents,
  live,
  selectedId,
  chains,
  showroom,
  night,
  onSelect,
  onPreview,
  className,
}: {
  agents: Agent[];
  live: Record<string, LiveState>;
  selectedId: string | null;
  chains: Record<string, Chain>;
  showroom: PinCard[];
  night: boolean;
  onSelect: (id: string) => void;
  onPreview: (jobId: string, file: Artifact) => void;
  className?: string;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  useEffect(
    () => () => {
      document.body.style.cursor = "auto";
    },
    []
  );
  const n = Math.max(agents.length, 1);
  const { cols, rows } = deskSlots(n);
  const width = Math.max(cols * GAP_X, 8.2);
  const depth = Math.max(rows * GAP_Z + 3.4, 10.5);
  const cx = width / 2 - GAP_X / 2;
  const camera = useMemo<[number, number, number]>(() => [cx + 4.2, 3.15, depth + 5.4], [cx, depth]);

  if (!ready) {
    return (
      <div className={`${className || ""} flex items-center justify-center text-[var(--ink-soft)]`}>
        Opening the office…
      </div>
    );
  }

  return (
    <WebGLFallback
      fallback={
        <div className={`${className || "h-full w-full"} flex items-center justify-center text-[var(--ink-soft)]`}>
          WebGL is unavailable. Click to try again.
        </div>
      }
    >
      <div className={`relative min-h-0 w-full ${className || "h-full"}`}>
        <Canvas
          className="absolute inset-0 h-full w-full"
          shadows
          camera={{ position: camera, fov: 36, near: 0.08, far: 280 }}
          dpr={[1, 1.5]}
          style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
          gl={{
            antialias: true,
            alpha: false,
            toneMapping: THREE.ACESFilmicToneMapping,
            powerPreference: "high-performance",
          }}
          onCreated={({ gl }) => {
            gl.domElement.style.touchAction = "none";
          }}
        >
          <Suspense fallback={null}>
            <OfficeScene
              agents={agents}
              live={live}
              selectedId={selectedId}
              chains={chains}
              showroom={showroom}
              night={night}
              onSelect={onSelect}
              onPreview={onPreview}
            />
          </Suspense>
        </Canvas>
      </div>
    </WebGLFallback>
  );
}
