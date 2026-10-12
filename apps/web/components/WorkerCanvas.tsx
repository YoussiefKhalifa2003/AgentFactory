"use client";

import { Component, ReactNode, RefObject, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls, RoundedBox, Text } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Agent, Activity, strengthLabel } from "@/lib/types";
import { AgentLook, parseLook } from "@/lib/look";
import { SpeechBubble } from "./scene/SpeechBubble";
import { HamzaWorker, isHamzaAgent } from "./scene/HamzaFigure";
import {
  Bookshelf,
  Clock,
  FiddlePlant,
  FloorLamp,
  LeafyPlant,
  SnakePlant,
  SunShafts,
  WaterDispenser,
  Window,
} from "./scene/OfficeDecor";

export class WebGLFallback extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("3D view failed", error);
  }
  render() {
    if (this.state.failed) {
      return (
        <div
          className="flex h-full min-h-0 w-full cursor-pointer flex-col items-center justify-center"
          onClick={() => this.setState({ failed: false })}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") this.setState({ failed: false });
          }}
          role="button"
          tabIndex={0}
        >
          {this.props.fallback}
        </div>
      );
    }
    return this.props.children;
  }
}

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function FreeOrbit({
  lookAt,
  minDistance,
  maxDistance,
  walk = false,
}: {
  lookAt: [number, number, number];
  minDistance: number;
  maxDistance: number;
  walk?: boolean;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const keys = useRef(new Set<string>());
  const steered = useRef(false);
  const x = lookAt[0];
  const y = lookAt[1];
  const z = lookAt[2];

  useLayoutEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;
    const next = new THREE.Vector3(x, y, z);
    if (steered.current && next.distanceTo(orbit.target) < 2.4) return;
    orbit.target.copy(next);
    orbit.update();
    steered.current = false;
  }, [x, y, z]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      keys.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => {
      keys.current.delete(e.code);
    };
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useFrame((_, dt) => {
    const orbit = controls.current;
    if (!orbit || !walk) return;
    const held = keys.current;
    if (!held.size) return;
    const cam = orbit.object;
    const forward = new THREE.Vector3();
    cam.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
    else forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3();
    if (held.has("KeyW") || held.has("ArrowUp")) move.add(forward);
    if (held.has("KeyS") || held.has("ArrowDown")) move.sub(forward);
    if (held.has("KeyD") || held.has("ArrowRight")) move.add(right);
    if (held.has("KeyA") || held.has("ArrowLeft")) move.sub(right);
    if (held.has("KeyE")) move.y += 1;
    if (held.has("KeyQ")) move.y -= 1;
    if (move.lengthSq() === 0) return;
    const boost = held.has("ShiftLeft") || held.has("ShiftRight") ? 2.2 : 1;
    move.normalize().multiplyScalar(9.5 * boost * dt);
    cam.position.add(move);
    orbit.target.add(move);
    if (cam.position.y < 0.7) {
      const dy = 0.7 - cam.position.y;
      cam.position.y += dy;
      orbit.target.y += dy;
    }
    steered.current = true;
    orbit.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      enableRotate
      enableZoom
      enableDamping
      dampingFactor={0.1}
      screenSpacePanning
      minDistance={minDistance}
      maxDistance={maxDistance}
      minPolarAngle={0.1}
      maxPolarAngle={Math.PI / 2 - 0.03}
      zoomSpeed={walk ? 1.45 : 1.15}
      rotateSpeed={walk ? 0.92 : 0.78}
      panSpeed={walk ? 1.45 : 1.05}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN,
      }}
      onStart={() => {
        steered.current = true;
      }}
    />
  );
}

function hexColor(hex: string) {
  try {
    return new THREE.Color(hex);
  } catch {
    return new THREE.Color("#d46a3a");
  }
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

function useRoomMaps(night: boolean) {
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
    });
    floor.wrapS = floor.wrapT = THREE.RepeatWrapping;
    floor.repeat.set(6, 6);

    const wall = canvasTexture((ctx, s) => {
      ctx.fillStyle = night ? "#322c27" : "#f3ece3";
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 280; i++) {
        const n = night ? 20 : 238;
        ctx.fillStyle = `rgba(${n},${n - 6},${n - 14},${0.04 + Math.random() * 0.05})`;
        ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
      }
    });
    wall.wrapS = wall.wrapT = THREE.RepeatWrapping;
    wall.repeat.set(2, 2);

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
    }, 128);

    return { floor, wall, sky };
  }, [night]);
}

function RoomWindow({
  position,
  night,
  sky,
}: {
  position: [number, number, number];
  night: boolean;
  sky: THREE.Texture;
}) {
  const trim = night ? "#4a4036" : "#cbb79a";
  return (
    <group position={position}>
      <RoundedBox args={[0.08, 1.55, 1.72]} radius={0.02}>
        <meshStandardMaterial color={trim} roughness={0.45} />
      </RoundedBox>
      <mesh position={[0.045, 0, 0]}>
        <planeGeometry args={[1.48, 1.32]} />
        <meshBasicMaterial map={sky} />
      </mesh>
      <mesh position={[0.05, 0, 0]}>
        <boxGeometry args={[0.03, 1.32, 0.04]} />
        <meshStandardMaterial color={trim} roughness={0.5} />
      </mesh>
      <mesh position={[0.05, 0, 0]}>
        <boxGeometry args={[1.48, 0.04, 0.04]} />
        <meshStandardMaterial color={trim} roughness={0.5} />
      </mesh>
    </group>
  );
}

function CornerPlant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.16, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.12, 0.3, 16]} />
        <meshStandardMaterial color="#c45c2c" roughness={0.48} />
      </mesh>
      <mesh position={[0, 0.52, 0]} castShadow>
        <icosahedronGeometry args={[0.28, 0]} />
        <meshStandardMaterial color="#3a6a4c" roughness={0.82} />
      </mesh>
      <mesh position={[0.14, 0.64, 0.05]} castShadow>
        <icosahedronGeometry args={[0.16, 0]} />
        <meshStandardMaterial color="#4f825d" roughness={0.82} />
      </mesh>
    </group>
  );
}

function NamePlaque({ name, night }: { name: string; night: boolean }) {
  return (
    <group position={[1.12, 0.798, 0.72]} rotation={[0, 0, 0]}>
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
          emissiveIntensity={on ? 1.2 : 0.06}
        />
      </mesh>
      {on && <pointLight position={[-0.1, 0.3, 0.12]} distance={3.2} intensity={1.8} color="#ffc27a" />}
    </group>
  );
}

function Exposure({ night }: { night: boolean }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.toneMappingExposure = night ? 0.78 : 1.18;
  }, [gl, night]);
  return null;
}

const LABELS: Record<string, string> = {
  idle: "Waiting at the desk",
  thinking: "Thinking through the job",
  write_file: "Writing files",
  "tool:sandbox": "Running code",
  "tool:web": "Reading a source",
  blocked: "Stuck — check the inspector",
  done: "Finished the job",
};

export function activityLabel(activity: Activity) {
  return LABELS[activity] || "Working";
}

function liftColor(hex: THREE.Color, minL: number, sat = 0) {
  const hsl = { h: 0, s: 0, l: 0 };
  hex.getHSL(hsl);
  hex.setHSL(hsl.h, THREE.MathUtils.clamp(hsl.s + sat, 0.28, 0.72), Math.max(minL, hsl.l));
  return hex;
}

function Cloth({ color, roughness = 0.62 }: { color: THREE.Color | string; roughness?: number }) {
  return (
    <meshStandardMaterial
      color={color}
      roughness={roughness}
      metalness={0}
      emissive={color}
      emissiveIntensity={0.16}
    />
  );
}

function useCanvasTexture(width: number, height: number) {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    texture.minFilter = THREE.LinearFilter;
    return { canvas, ctx, texture };
  }, [width, height]);
}

function wrapFeed(text: string, width = 56): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\t/g, "  ").split("\n")) {
    if (raw.length <= width) {
      out.push(raw);
      continue;
    }
    for (let i = 0; i < raw.length; i += width) out.push(raw.slice(i, i + width));
  }
  return out;
}

function paintScreen(
  ctx: CanvasRenderingContext2D,
  activity: Activity,
  pigment: string,
  t: number,
  feed?: string
) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = "#12171d";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#1c242e";
  ctx.fillRect(0, 0, w, 34);
  ctx.fillStyle = "#ff5f57";
  ctx.beginPath();
  ctx.arc(18, 17, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#febc2e";
  ctx.beginPath();
  ctx.arc(36, 17, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#28c840";
  ctx.beginPath();
  ctx.arc(54, 17, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = pigment;
  ctx.fillRect(0, 34, 5, h - 34);

  ctx.fillStyle = "#151c24";
  ctx.fillRect(0, 34, w, h - 34);

  const busy = activity !== "idle" && activity !== "done" && activity !== "blocked";
  const body = (feed || "").trim();
  ctx.font = "16px ui-monospace, monospace";
  const lineH = 22;
  const maxLines = Math.max(6, Math.floor((h - 52) / lineH));
  let lines: string[];
  if (body) {
    lines = wrapFeed(body).slice(-maxLines);
  } else if (activity === "idle") {
    lines = ["ready", "awaiting job", "send a task"];
  } else if (activity === "blocked") {
    lines = ["blocked", "check inspector"];
  } else if (activity === "done") {
    lines = ["job finished"];
  } else {
    lines = ["working…"];
  }

  lines.forEach((line, i) => {
    if (activity === "blocked") ctx.fillStyle = "#ff8a80";
    else if (activity === "done") ctx.fillStyle = "#8ee0a8";
    else if (line.startsWith("#") || line.startsWith("$")) ctx.fillStyle = pigment;
    else ctx.fillStyle = "#d7e2ea";
    ctx.fillText(line, 24, 60 + i * lineH);
  });

  if (busy) {
    const blink = Math.sin(t * 6) > 0;
    if (blink) {
      const last = lines[lines.length - 1] || "";
      ctx.fillStyle = "#f4f7fa";
      ctx.fillRect(24 + Math.min(last.length, 40) * 9.6, 46 + (lines.length - 1) * lineH, 8, 16);
    }
  }
}

function paintKeys(ctx: CanvasRenderingContext2D) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = "#3f3a36";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#8a837c";
  const cols = 14;
  const rows = 5;
  const pad = 8;
  const kw = (w - pad * 2) / cols - 3;
  const kh = (h - pad * 2) / rows - 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillRect(pad + c * (kw + 3) + (r === 4 ? 18 : 0), pad + r * (kh + 3), kw, kh);
    }
  }
}

function fitCapsule(
  mesh: THREE.Mesh | null,
  a: [number, number, number],
  b: [number, number, number],
  radius: number,
  restLen: number
) {
  if (!mesh) return;
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A);
  const len = dir.length();
  mesh.position.copy(A).lerp(B, 0.5);
  if (len > 0.001) {
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }
  mesh.scale.set(1, Math.max(0.04, len - radius * 2) / restLen, 1);
}

function ArmBones({
  shoulder,
  handRef,
  rest,
  outZ,
  upperColor,
  lowerColor,
}: {
  shoulder: [number, number, number];
  handRef: RefObject<THREE.Group | null>;
  rest: [number, number, number];
  outZ: number;
  upperColor: THREE.Color | string;
  lowerColor: string;
}) {
  const upper = useRef<THREE.Mesh>(null);
  const lower = useRef<THREE.Mesh>(null);
  const restLen = 0.16;
  useFrame(() => {
    const p = handRef.current?.position;
    const hand: [number, number, number] = p ? [p.x, p.y, p.z] : rest;
    const elbow = elbowOf(shoulder, hand, outZ);
    fitCapsule(upper.current, shoulder, elbow, 0.05, restLen);
    fitCapsule(lower.current, elbow, hand, 0.042, restLen);
  });
  return (
    <>
      <mesh ref={upper} castShadow>
        <capsuleGeometry args={[0.05, restLen, 6, 12]} />
        <meshStandardMaterial color={upperColor} roughness={0.75} metalness={0.04} />
      </mesh>
      <mesh ref={lower} castShadow>
        <capsuleGeometry args={[0.042, restLen, 6, 12]} />
        <meshStandardMaterial color={lowerColor} roughness={0.75} metalness={0.04} />
      </mesh>
    </>
  );
}

function elbowOf(
  shoulder: [number, number, number],
  hand: [number, number, number],
  outZ: number
): [number, number, number] {
  const S = new THREE.Vector3(...shoulder);
  const H = new THREE.Vector3(...hand);
  const mid = S.clone().lerp(H, 0.5);
  const dir = H.clone().sub(S).normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(dir);
  if (side.lengthSq() < 0.001) side.set(1, 0, 0);
  side.normalize().multiplyScalar(outZ);
  mid.add(side);
  mid.y -= 0.05;
  return [mid.x, mid.y, mid.z];
}

function OfficeChair() {
  const leather = "#d7c4ad";
  const metal = "#a89480";
  return (
    <group>
      {[0, 1, 2, 3, 4].map((i) => (
        <group key={i} rotation={[0, (i * Math.PI * 2) / 5, 0]}>
          <mesh position={[0.17, 0.045, 0]} castShadow>
            <boxGeometry args={[0.32, 0.03, 0.055]} />
            <meshStandardMaterial color={metal} metalness={0.25} roughness={0.45} />
          </mesh>
          <mesh position={[0.32, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.035, 0.035, 0.045, 12]} />
            <meshStandardMaterial color="#8d7a68" metalness={0.2} roughness={0.5} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.04, 0.34, 12]} />
        <meshStandardMaterial color={metal} metalness={0.22} roughness={0.42} />
      </mesh>
      <RoundedBox args={[0.5, 0.07, 0.5]} radius={0.04} position={[0.04, 0.44, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={leather} roughness={0.62} />
      </RoundedBox>
      <RoundedBox
        args={[0.08, 0.52, 0.48]}
        radius={0.04}
        position={[-0.18, 0.74, 0]}
        rotation={[0, 0, 0.08]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={leather} roughness={0.62} />
      </RoundedBox>
    </group>
  );
}

function OutfitExtras({
  outfit,
  shirt,
  w,
  accent,
}: {
  outfit: AgentLook["outfit"];
  shirt: THREE.Color;
  w: number;
  accent: THREE.Color;
}) {
  const fx = 0.04 + 0.15 * (0.6 + 0.4 * w) - 0.003;
  const dark = shirt.clone().offsetHSL(0, 0, -0.1);
  switch (outfit) {
    case "hoodie":
      return (
        <group>
          <mesh position={[-0.04, 0.58, 0]} scale={[0.9, 0.6, 1.2 * w]} castShadow>
            <sphereGeometry args={[0.11, 16, 12]} />
            <Cloth color={shirt} />
          </mesh>
          <mesh position={[fx, 0.2, 0]} castShadow>
            <boxGeometry args={[0.014, 0.08, 0.17 * w]} />
            <Cloth color={dark} />
          </mesh>
        </group>
      );
    case "blazer":
      return (
        <group>
          <mesh position={[fx, 0.45, 0]}>
            <boxGeometry args={[0.012, 0.2, 0.075]} />
            <meshStandardMaterial color="#f4f1ea" roughness={0.6} />
          </mesh>
          <mesh position={[fx + 0.004, 0.4, 0]}>
            <boxGeometry args={[0.012, 0.15, 0.028]} />
            <meshStandardMaterial color={accent} roughness={0.5} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[fx + 0.002, 0.45, s * 0.058 * w]} rotation={[s * 0.28, 0, 0]}>
              <boxGeometry args={[0.014, 0.22, 0.05]} />
              <Cloth color={dark} />
            </mesh>
          ))}
        </group>
      );
    case "apron":
      return (
        <group>
          <mesh position={[fx + 0.003, 0.22, 0]} castShadow>
            <boxGeometry args={[0.014, 0.32, 0.2 * w]} />
            <meshStandardMaterial color="#eadcc2" roughness={0.75} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[fx + 0.003, 0.52, s * 0.065 * w]}>
              <boxGeometry args={[0.012, 0.14, 0.02]} />
              <meshStandardMaterial color="#eadcc2" roughness={0.75} />
            </mesh>
          ))}
        </group>
      );
    case "lab":
      return (
        <group>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[fx - 0.002, 0.56, s * 0.065]} rotation={[s * 0.35, 0, 0]}>
              <boxGeometry args={[0.03, 0.06, 0.06]} />
              <Cloth color={shirt} />
            </mesh>
          ))}
          <mesh position={[fx + 0.002, 0.25, 0.08 * w]}>
            <boxGeometry args={[0.012, 0.06, 0.055]} />
            <meshStandardMaterial color="#dcdcd6" roughness={0.6} />
          </mesh>
          <mesh position={[fx + 0.006, 0.29, 0.08 * w]}>
            <boxGeometry args={[0.008, 0.04, 0.008]} />
            <meshStandardMaterial color={accent} />
          </mesh>
        </group>
      );
    case "cardigan":
      return (
        <group>
          <mesh position={[fx + 0.002, 0.3, 0]}>
            <boxGeometry args={[0.012, 0.36, 0.02]} />
            <meshStandardMaterial color="#5a4330" roughness={0.8} />
          </mesh>
          {[0.46, 0.36, 0.26].map((y) => (
            <mesh key={y} position={[fx + 0.008, y, 0.03]}>
              <sphereGeometry args={[0.012, 8, 8]} />
              <meshStandardMaterial color="#5a4330" roughness={0.5} />
            </mesh>
          ))}
        </group>
      );
    default:
      return null;
  }
}

function HeadParts({
  look,
  skin,
  hair,
  accent,
}: {
  look: AgentLook;
  skin: string;
  hair: string;
  accent: THREE.Color;
}) {
  const square = look.head === "square";
  const sc: [number, number, number] = look.head === "oval" ? [0.92, 1.14, 0.92] : [1, 1, 1];
  const sy = sc[1];
  const ex = square ? 0.127 : look.head === "oval" ? 0.121 : 0.13;
  const top = square ? 0.13 : 0.138 * sy;
  const eye = { round: [1, 1], almond: [1.1, 0.65], narrow: [0.9, 0.4], wide: [1.35, 1.1], sleepy: [1.1, 0.3] }[
    look.eyes
  ];
  const hairMat = <meshStandardMaterial color={hair} roughness={0.72} emissive={hair} emissiveIntensity={0.1} />;
  const cap = (scale: [number, number, number], y: number) => (
    <mesh position={[0, y, 0]} scale={scale} castShadow>
      <sphereGeometry args={[0.13, 18, 14]} />
      {hairMat}
    </mesh>
  );
  const ball = (x: number, y: number, z: number, r: number, key: string | number) => (
    <mesh key={key} position={[x, y, z]} castShadow>
      <sphereGeometry args={[r, 12, 10]} />
      {hairMat}
    </mesh>
  );
  return (
    <group>
      {square ? (
        <RoundedBox args={[0.25, 0.26, 0.25]} radius={0.07} smoothness={4} castShadow>
          <meshStandardMaterial color={skin} roughness={0.5} emissive={skin} emissiveIntensity={0.12} />
        </RoundedBox>
      ) : (
        <mesh scale={sc} castShadow>
          <sphereGeometry args={[0.138, 24, 24]} />
          <meshStandardMaterial color={skin} roughness={0.5} emissive={skin} emissiveIntensity={0.12} />
        </mesh>
      )}

      {/* face */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[ex, 0.012, s * 0.05]} scale={[0.5, eye[1], eye[0]]}>
            <sphereGeometry args={[0.016, 10, 10]} />
            <meshStandardMaterial color="#2a2623" roughness={0.3} />
          </mesh>
          <mesh
            position={[ex - 0.002, 0.055, s * 0.05]}
            rotation={[s * (look.brows === "arch" ? 0.3 : 0), 0, 0]}
          >
            <boxGeometry args={[0.006, look.brows === "thick" ? 0.012 : 0.006, 0.04]} />
            <meshStandardMaterial color={hair} roughness={0.8} />
          </mesh>
        </group>
      ))}
      <mesh position={[ex - 0.002, -0.055, 0]} rotation={[look.mouth === "smirk" ? 0.25 : 0, 0, 0]}>
        <boxGeometry args={[0.006, look.mouth === "smile" ? 0.012 : 0.007, look.mouth === "neutral" ? 0.04 : 0.05]} />
        <meshStandardMaterial color="#9a4a3a" roughness={0.6} />
      </mesh>

      {/* hair */}
      {look.hair === "short" && cap([1.04, 0.52, 1.04], top - 0.06)}
      {look.hair === "fade" && cap([1.02, 0.38, 1.02], top - 0.05)}
      {look.hair === "undercut" && (
        <RoundedBox args={[0.2, 0.07, 0.16]} radius={0.03} position={[0.02, top + 0.005, 0]} castShadow>
          {hairMat}
        </RoundedBox>
      )}
      {look.hair === "wavy" && (
        <group>
          {cap([1.04, 0.55, 1.04], top - 0.06)}
          {[0, 1, 2, 3, 4].map((i) => ball(Math.cos(i * 1.26) * 0.09, top - 0.045, Math.sin(i * 1.26) * 0.11, 0.05, i))}
        </group>
      )}
      {look.hair === "curly" && (
        <group>
          {cap([1.0, 0.5, 1.0], top - 0.07)}
          {Array.from({ length: 9 }, (_, i) =>
            ball(
              i === 8 ? 0 : Math.cos(i * 0.785) * 0.085,
              i === 8 ? top + 0.03 : top - 0.03 - (i % 2) * 0.02,
              i === 8 ? 0 : Math.sin(i * 0.785) * 0.1,
              0.052,
              i
            )
          )}
        </group>
      )}
      {look.hair === "bun" && (
        <group>
          {cap([1.04, 0.52, 1.04], top - 0.06)}
          {ball(-0.04, top + 0.06, 0, 0.065, "bun")}
        </group>
      )}
      {look.hair === "long" && (
        <group>
          {cap([1.05, 0.56, 1.05], top - 0.06)}
          <mesh position={[-0.1, -0.06, 0]} scale={[0.75, 1, 1.25]} castShadow>
            <capsuleGeometry args={[0.1, 0.2, 6, 14]} />
            {hairMat}
          </mesh>
        </group>
      )}

      {/* accessories */}
      {look.accessory === "glasses" && (
        <group>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[ex + 0.006, 0.012, s * 0.05]} rotation={[0, Math.PI / 2, 0]}>
              <torusGeometry args={[0.03, 0.005, 8, 20]} />
              <meshStandardMaterial color="#1f1c1a" roughness={0.4} metalness={0.3} />
            </mesh>
          ))}
          <mesh position={[ex + 0.006, 0.02, 0]}>
            <boxGeometry args={[0.005, 0.005, 0.03]} />
            <meshStandardMaterial color="#1f1c1a" />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0.03, 0.02, s * 0.1]}>
              <boxGeometry args={[0.2, 0.005, 0.005]} />
              <meshStandardMaterial color="#1f1c1a" />
            </mesh>
          ))}
        </group>
      )}
      {look.accessory === "headphones" && (
        <group>
          <mesh position={[0, 0, 0]} rotation={[0, Math.PI / 2, 0]} castShadow>
            <torusGeometry args={[0.15 * (square ? 1 : 1), 0.012, 8, 28, Math.PI]} />
            <meshStandardMaterial color="#2a2623" roughness={0.4} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0, 0, s * (square ? 0.135 : 0.14)]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.052, 0.052, 0.035, 18]} />
              <meshStandardMaterial color={accent} roughness={0.45} />
            </mesh>
          ))}
        </group>
      )}
      {look.accessory === "cap" && (
        <group>
          <mesh position={[0, top - 0.11, 0]} scale={[1.05, 1, 1.05]} castShadow>
            <sphereGeometry args={[0.145, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={accent} roughness={0.6} />
          </mesh>
          <mesh position={[0.15, top - 0.105, 0]} castShadow>
            <boxGeometry args={[0.1, 0.012, 0.17]} />
            <meshStandardMaterial color={accent} roughness={0.6} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function CapsuleWorker({ agent, activity, stand }: { agent: Agent; activity: Activity; stand?: boolean }) {
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const leftHand = useRef<THREE.Group>(null);
  const rightHand = useRef<THREE.Group>(null);
  const color = useMemo(() => hexColor(agent.pigment), [agent.pigment]);
  const look = useMemo(
    () => parseLook(agent.look, agent.name, agent.pigment),
    [agent.look, agent.name, agent.pigment]
  );
  const shirt = useMemo(() => {
    const base = liftColor(color.clone(), 0.46, 0.08);
    switch (look.outfit) {
      case "blazer":
        return color.clone().offsetHSL(0, -0.12, -0.2);
      case "lab":
        return new THREE.Color("#f3f3ef");
      case "cardigan":
        return new THREE.Color("#b98f63").lerp(color, 0.25);
      default:
        return base;
    }
  }, [color, look.outfit]);
  const hair = look.hairColor;
  const skin = look.skin;
  const pants = "#cbb59a";
  // body build: width of torso/hips and shoulder spread
  const build = { slim: { w: 0.82, s: 0.86 }, regular: { w: 1, s: 1 }, broad: { w: 1.28, s: 1.25 } }[look.body];
  const sz = 0.19 * build.s;

  const leftShoulder: [number, number, number] = [0.06, 0.46, sz];
  const rightShoulder: [number, number, number] = [0.06, 0.46, -sz];
  const leftHome: [number, number, number] = [0.41, 0.31, 0.13 + (build.s - 1) * 0.12];
  const rightHome: [number, number, number] = [0.44, 0.318, -0.24 - (build.s - 1) * 0.12];

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const busy = activity !== "idle" && activity !== "done" && activity !== "blocked";
    const typing = busy && activity !== "tool:web";
    const mousing = busy;
    const think = activity === "thinking";
    const done = activity === "done";
    const blocked = activity === "blocked";
    const web = activity === "tool:web";

    if (torso.current) {
      torso.current.rotation.z = done ? 0.02 : blocked ? 0.16 : busy ? 0.1 : 0.08;
      torso.current.position.y =
        (stand ? 0.1 : 0) + Math.sin(t * (busy ? 2.2 : 1.5)) * (busy ? 0.01 : 0.006);
    }
    if (head.current) {
      if (think) {
        head.current.rotation.y = 0.08 + Math.sin(t * 1.1) * 0.1;
        head.current.rotation.x = 0.12;
      } else if (web) {
        head.current.rotation.y = 0.04;
        head.current.rotation.x = 0.08;
      } else if (done) {
        head.current.rotation.y = Math.sin(t * 1.4) * 0.06;
        head.current.rotation.x = -0.04;
      } else if (blocked) {
        head.current.rotation.x = 0.28;
        head.current.rotation.y = -0.12;
      } else {
        head.current.rotation.y = 0.1;
        head.current.rotation.x = 0.08;
      }
    }
    if (leftHand.current) {
      leftHand.current.position.set(
        leftHome[0] + (typing ? Math.sin(t * 14) * 0.02 : 0),
        leftHome[1] + (typing ? Math.abs(Math.sin(t * 17)) * 0.014 : 0),
        leftHome[2] + (typing ? Math.sin(t * 11 + 0.8) * 0.028 : 0)
      );
    }
    if (rightHand.current) {
      const click = mousing && Math.sin(t * 8) > 0.55 ? 0.012 : 0;
      rightHand.current.position.set(
        rightHome[0] + (mousing ? Math.sin(t * 4.6) * 0.012 : 0),
        rightHome[1] + click,
        rightHome[2] + (mousing ? Math.sin(t * 3.8 + 1.2) * 0.02 : 0)
      );
    }
  });

  return (
    <group position={[0.22, 0.47, 0]}>
      <group scale={[1, 1, 0.85 + build.w * 0.15 + (build.s - 1) * 0.5]}>
      <mesh position={[0.2, -0.02, 0.1]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <capsuleGeometry args={[0.072, 0.26, 6, 14]} />
        <Cloth color={pants} />
      </mesh>
      <mesh position={[0.2, -0.02, -0.1]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <capsuleGeometry args={[0.072, 0.26, 6, 14]} />
        <Cloth color={pants} />
      </mesh>
      <mesh position={[0.36, -0.22, 0.1]} castShadow>
        <capsuleGeometry args={[0.064, 0.28, 6, 14]} />
        <Cloth color={pants} />
      </mesh>
      <mesh position={[0.36, -0.22, -0.1]} castShadow>
        <capsuleGeometry args={[0.064, 0.28, 6, 14]} />
        <Cloth color={pants} />
      </mesh>
      <RoundedBox args={[0.18, 0.05, 0.09]} radius={0.02} position={[0.44, -0.42, 0.1]} castShadow>
        <meshStandardMaterial color="#a89078" roughness={0.7} />
      </RoundedBox>
      <RoundedBox args={[0.18, 0.05, 0.09]} radius={0.02} position={[0.44, -0.42, -0.1]} castShadow>
        <meshStandardMaterial color="#a89078" roughness={0.7} />
      </RoundedBox>
      </group>

      <group ref={torso}>
        <mesh position={[0.04, 0.3, 0]} scale={[0.6 + build.w * 0.4, 1, build.w]} castShadow>
          <capsuleGeometry args={[0.15, 0.34, 8, 16]} />
          <Cloth color={shirt} roughness={0.62} />
        </mesh>
        <OutfitExtras outfit={look.outfit} shirt={shirt} w={build.w} accent={color} />
        {look.accessory === "scarf" && (
          <mesh position={[0.07, 0.6, 0]} rotation={[Math.PI / 2, 0, 0.1]} castShadow>
            <torusGeometry args={[0.1 + (build.w - 1) * 0.03, 0.04, 10, 24]} />
            <Cloth color={color.clone().offsetHSL(0.5, 0, 0)} />
          </mesh>
        )}
        <group ref={head} position={[0.08, 0.66, 0]}>
          <HeadParts look={look} skin={skin} hair={hair} accent={color} />
        </group>
      </group>

      <ArmBones
        shoulder={leftShoulder}
        handRef={leftHand}
        rest={leftHome}
        outZ={0.08}
        upperColor={shirt}
        lowerColor={skin}
      />
      <ArmBones
        shoulder={rightShoulder}
        handRef={rightHand}
        rest={rightHome}
        outZ={-0.08}
        upperColor={shirt}
        lowerColor={skin}
      />

      <group ref={leftHand} position={leftHome}>
        <mesh castShadow>
          <sphereGeometry args={[0.038, 12, 12]} />
          <meshStandardMaterial color={skin} roughness={0.55} />
        </mesh>
      </group>
      <group ref={rightHand} position={rightHome}>
        <mesh castShadow>
          <sphereGeometry args={[0.036, 12, 12]} />
          <meshStandardMaterial color={skin} roughness={0.55} />
        </mesh>
      </group>
    </group>
  );
}

function Worker({ agent, activity, stand }: { agent: Agent; activity: Activity; stand?: boolean }) {
  if (isHamzaAgent(agent)) {
    return (
      <Suspense fallback={null}>
        <HamzaWorker agent={agent} activity={activity} stand={stand} />
      </Suspense>
    );
  }
  return <CapsuleWorker agent={agent} activity={activity} stand={stand} />;
}

function Desk({
  agent,
  activity,
  feed,
}: {
  agent: Agent;
  activity: Activity;
  feed?: string;
}) {
  const screen = useCanvasTexture(640, 400);
  const keys = useCanvasTexture(512, 200);
  const color = useMemo(() => hexColor(agent.pigment), [agent.pigment]);
  const glow = useRef<THREE.PointLight>(null);
  const lastPaint = useRef(0);

  useMemo(() => {
    if (keys.ctx) paintKeys(keys.ctx);
    keys.texture.needsUpdate = true;
  }, [keys]);

  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (screen.ctx && now - lastPaint.current > 1 / 15) {
      lastPaint.current = now;
      paintScreen(screen.ctx, activity, agent.pigment, now, feed);
      screen.texture.needsUpdate = true;
    }
    if (glow.current) {
      const typing = activity === "write_file" || activity === "tool:sandbox";
      glow.current.color.set(
        activity === "blocked" ? "#b42318" : activity === "done" ? "#2f9e44" : agent.pigment
      );
      glow.current.intensity =
        activity === "idle" ? 0.12 : activity === "done" ? 0.16 : typing || activity === "thinking" ? 0.3 : 0.22;
    }
  });

  const wood = "#cbb087";
  const leg = "#8d7356";

  return (
    <group>
      <RoundedBox args={[0.82, 0.06, 1.62]} radius={0.025} position={[0.98, 0.73, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={wood} roughness={0.62} />
      </RoundedBox>
      {[
        [0.64, -0.68],
        [1.3, -0.68],
        [0.64, 0.68],
        [1.3, 0.68],
      ].map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, 0.36, z]} castShadow>
          <cylinderGeometry args={[0.035, 0.04, 0.72, 10]} />
          <meshStandardMaterial color={leg} roughness={0.5} />
        </mesh>
      ))}

      <group position={[1.2, 0.76, 0]} rotation={[0, 0.12, 0]}>
        <mesh position={[0, 0.018, 0]} castShadow>
          <boxGeometry args={[0.16, 0.02, 0.16]} />
          <meshStandardMaterial color="#7a6e62" metalness={0.2} roughness={0.48} />
        </mesh>
        <mesh position={[0, 0.16, 0]} castShadow>
          <cylinderGeometry args={[0.018, 0.024, 0.28, 10]} />
          <meshStandardMaterial color="#7a6e62" metalness={0.2} roughness={0.45} />
        </mesh>
        <group position={[0, 0.4, 0]}>
          <RoundedBox args={[0.045, 0.36, 0.58]} radius={0.012} castShadow>
            <meshStandardMaterial color="#5e564e" metalness={0.22} roughness={0.4} />
          </RoundedBox>
          <mesh position={[-0.026, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
            <planeGeometry args={[0.52, 0.31]} />
            <meshStandardMaterial
              map={screen.texture}
              emissive="#ffffff"
              emissiveMap={screen.texture}
              emissiveIntensity={0.85}
              roughness={0.88}
              metalness={0}
              toneMapped={false}
            />
          </mesh>
        </group>
        <pointLight ref={glow} position={[-0.2, 0.18, 0]} distance={1.1} intensity={0.12} color={color} />
      </group>

      <group position={[0.7, 0.761, 0.04]}>
        <mesh position={[0, 0.01, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.15, 0.016, 0.34]} />
          <meshStandardMaterial color="#8a7d70" roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, Math.PI / 2]} receiveShadow>
          <planeGeometry args={[0.32, 0.13]} />
          <meshStandardMaterial map={keys.texture} roughness={0.42} />
        </mesh>
      </group>
      <group position={[0.72, 0.772, -0.28]} rotation={[0.08, 0.2, 0]}>
        <RoundedBox args={[0.09, 0.026, 0.055]} radius={0.012} castShadow>
          <meshStandardMaterial color="#4a4038" roughness={0.34} />
        </RoundedBox>
      </group>

      <group position={[1.26, 0.76, 0.52]}>
        <mesh position={[0, 0.07, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.034, 0.12, 16]} />
          <meshStandardMaterial color={color} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.13, 0]}>
          <cylinderGeometry args={[0.044, 0.04, 0.018, 16]} />
          <meshStandardMaterial color="#f4efe6" roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

function Room({ pigment, night }: { pigment: string; night: boolean }) {
  const maps = useRoomMaps(night);
  const rug = useMemo(() => hexColor(pigment).offsetHSL(0, -0.18, night ? -0.12 : 0.22), [pigment, night]);

  useEffect(() => {
    return () => {
      maps.floor.dispose();
      maps.wall.dispose();
      maps.sky.dispose();
    };
  }, [maps]);

  return (
    <group>
      <mesh position={[-3.4, 1.7, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[8, 5]} />
        <meshBasicMaterial map={maps.sky} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.45, 0, 0]} receiveShadow>
        <planeGeometry args={[9.5, 9.5]} />
        <meshStandardMaterial map={maps.floor} roughness={0.84} metalness={0.04} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.45, 0.006, 0]} receiveShadow>
        <circleGeometry args={[1.7, 48]} />
        <meshStandardMaterial color={rug} roughness={0.9} />
      </mesh>
      <mesh position={[-1.62, 1.45, 0]} receiveShadow>
        <boxGeometry args={[0.14, 2.9, 6.4]} />
        <meshStandardMaterial map={maps.wall} roughness={0.92} />
      </mesh>
      <mesh position={[0.55, 1.45, -1.92]} receiveShadow>
        <boxGeometry args={[5.2, 2.9, 0.14]} />
        <meshStandardMaterial map={maps.wall} roughness={0.92} />
      </mesh>
      <mesh position={[0.45, 2.92, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[9.5, 9.5]} />
        <meshStandardMaterial color={night ? "#2a2420" : "#faf6f0"} roughness={0.95} />
      </mesh>
      <mesh position={[0.55, 0.07, -1.84]}>
        <boxGeometry args={[5, 0.14, 0.08]} />
        <meshStandardMaterial color={night ? "#4a4036" : "#cbb79a"} roughness={0.55} />
      </mesh>
      <mesh position={[-1.54, 0.07, 0]}>
        <boxGeometry args={[0.08, 0.14, 6]} />
        <meshStandardMaterial color={night ? "#4a4036" : "#cbb79a"} roughness={0.55} />
      </mesh>
      <RoomWindow position={[-1.53, 1.62, 0.15]} night={night} sky={maps.sky} />
      <mesh position={[0.55, 2.86, 0]}>
        <boxGeometry args={[2.8, 0.05, 0.36]} />
        <meshStandardMaterial
          color={night ? "#ffb070" : "#fff6ea"}
          emissive={night ? "#c45c2c" : "#fff3dc"}
          emissiveIntensity={night ? 0.22 : 0.7}
          roughness={0.35}
        />
      </mesh>
      <mesh position={[0.72, 2.55, -0.15]}>
        <cylinderGeometry args={[0.005, 0.005, 0.55, 8]} />
        <meshStandardMaterial color="#2a2623" metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh position={[0.72, 2.24, -0.15]} castShadow>
        <cylinderGeometry args={[0.16, 0.22, 0.12, 24]} />
        <meshStandardMaterial
          color="#f3ece3"
          roughness={0.35}
          emissive="#fff4dc"
          emissiveIntensity={night ? 0.28 : 0.65}
        />
      </mesh>
      <pointLight position={[0.72, 2.12, -0.15]} intensity={night ? 0.55 : 1.4} distance={7} color="#ffe2b8" />
      <Window x={-1.55} y={1.62} z={0.15} night={night} />
      {!night && <SunShafts x={-1.45} y={1.62} z={0.15} />}
      <Bookshelf position={[1.75, 0, -1.66]} night={night} />
      <Clock position={[0.2, 2.3, -1.83]} />
      <WaterDispenser position={[-0.95, 0, -1.6]} />
      <FiddlePlant position={[2.98, 0, -1.3]} scale={1.05} seed={7} />
      <LeafyPlant position={[-1.25, 0, 1.45]} scale={1} seed={3} potColor="#c45c2c" />
      <SnakePlant position={[-1.3, 0, -0.85]} scale={0.95} seed={5} />
      <FloorLamp position={[3.0, 0, 0.3]} night={night} />
    </group>
  );
}

export function Station({
  agent,
  activity,
  feed,
  room = true,
  night = false,
}: {
  agent: Agent;
  activity: Activity;
  feed?: string;
  room?: boolean;
  night?: boolean;
}) {
  const working = activity !== "idle" && activity !== "done" && activity !== "blocked";
  return (
    <group>
      {room && <Room pigment={agent.pigment} night={night} />}
      <group rotation={[0, room ? 0.42 : 0.38, 0]}>
        <group position={[0.08, 0, 0]}>
          <OfficeChair />
        </group>
        <Worker agent={agent} activity={activity} stand={working} />
        <Desk agent={agent} activity={activity} feed={feed} />
        <SpeechBubble caption={feed || (working ? "Working" : "")} activity={activity} />
        {room && <NamePlaque name={agent.name} night={night} />}
        {room && <DeskLamp on={night ? working : false} />}
      </group>
    </group>
  );
}

export function WorkerCanvas({
  agent,
  activity,
  feed,
  className,
  mode = "stage",
  night = false,
}: {
  agent: Agent;
  activity: Activity;
  feed?: string;
  className?: string;
  mode?: "stage" | "preview";
  night?: boolean;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const preview = mode === "preview";
  const camera = useMemo(
    () =>
      preview
        ? { position: [2.15, 1.85, 3.35] as [number, number, number], fov: 38, near: 0.08, far: 160 }
        : { position: [1.52, 1.36, 2.18] as [number, number, number], fov: 34, near: 0.08, far: 160 },
    [preview]
  );
  const lookAt = useMemo<[number, number, number]>(
    () => (preview ? [0.55, 0.86, 0] : [0.22, 1.04, 0.02]),
    [preview]
  );
  const strengths = (agent.strengths || []).map(strengthLabel).join(" · ") || "General";
  if (!ready) {
    return (
      <div className={`${className || ""} flex items-center justify-center text-[var(--ink-soft)]`}>
        Opening the desk…
      </div>
    );
  }
  return (
    <WebGLFallback
      fallback={
        <div className={`${className || "h-full w-full"} flex items-center justify-center text-[var(--ink-soft)]`}>
          Couldn&apos;t open the desk. Click to try again.
        </div>
      }
    >
      <div className={`relative min-h-0 w-full ${className || "h-full"}`}>
        <Canvas
          className="absolute inset-0 h-full w-full"
          shadows
          camera={camera}
          dpr={[1, 1.5]}
          style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
          gl={{
            antialias: true,
            alpha: false,
            toneMapping: THREE.ACESFilmicToneMapping,
            powerPreference: "high-performance",
          }}
        >
          <color attach="background" args={[night ? "#12100e" : "#d9cbb8"]} />
          <fog attach="fog" args={[night ? "#12100e" : "#d9cbb8", 18, 70]} />
          <Exposure night={night} />
          <ambientLight intensity={night ? 0.22 : 0.58} />
          <hemisphereLight args={night ? ["#3a2e24", "#0c0a09", 0.36] : ["#fffaf2", "#d2c0a6", 0.72]} />
          <directionalLight
            position={[-2.8, 5.4, 1.4]}
            intensity={night ? 0.22 : 1.55}
            color={night ? "#8aa0c8" : "#fff3dc"}
            castShadow={!night}
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-bias={-0.00025}
            shadow-camera-near={0.5}
            shadow-camera-far={16}
            shadow-camera-left={-4}
            shadow-camera-right={4}
            shadow-camera-top={4}
            shadow-camera-bottom={-4}
          />
          {!night && <directionalLight position={[2.2, 2.4, -1.8]} intensity={0.32} color="#ffd9a8" />}
          <Suspense fallback={null}>
            <Station agent={agent} activity={activity} feed={feed} night={night} />
          </Suspense>
          <ContactShadows
            frames={1}
            position={[0, 0.01, 0]}
            opacity={night ? 0.5 : 0.34}
            scale={9}
            blur={2.4}
            far={5}
          />
          <FreeOrbit lookAt={lookAt} minDistance={preview ? 0.7 : 0.55} maxDistance={preview ? 28 : 22} />
        </Canvas>
        <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-end justify-between gap-3">
          <div className="rounded-2xl bg-white/92 px-4 py-3 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
              {agent.name} · {strengths}
            </p>
            <p className="mt-1 text-sm font-medium">{activityLabel(activity)}</p>
          </div>
          {!preview && (
            <p className="mb-1 text-xs text-[var(--ink-soft)]">Drag to look · right-drag or WASD to move · scroll to zoom</p>
          )}
        </div>
      </div>
    </WebGLFallback>
  );
}
