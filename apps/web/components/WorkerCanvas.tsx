"use client";

import { Component, ReactNode, RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls, RoundedBox, Text } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Agent, Activity, strengthLabel } from "@/lib/types";

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

export function FreeOrbit({
  lookAt,
  minDistance,
  maxDistance,
}: {
  lookAt: [number, number, number];
  minDistance: number;
  maxDistance: number;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const x = lookAt[0];
  const y = lookAt[1];
  const z = lookAt[2];

  useLayoutEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;
    orbit.target.set(x, y, z);
    orbit.update();
  }, [x, y, z]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      enableRotate
      enableZoom
      enableDamping
      dampingFactor={0.08}
      screenSpacePanning
      minDistance={minDistance}
      maxDistance={maxDistance}
      minPolarAngle={0.18}
      maxPolarAngle={Math.PI / 2 - 0.05}
      zoomSpeed={1.05}
      rotateSpeed={0.62}
      panSpeed={0.85}
      onChange={() => {
        const orbit = controls.current;
        if (!orbit) return;
        if (orbit.object.position.y < 0.55) orbit.object.position.y = 0.55;
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
    gl.toneMappingExposure = night ? 0.68 : 1.08;
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

function Cloth({ color, roughness = 0.82 }: { color: THREE.Color | string; roughness?: number }) {
  return <meshStandardMaterial color={color} roughness={roughness} metalness={0.04} />;
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
  const leather = "#2f2b28";
  const metal = "#1a1816";
  return (
    <group>
      {[0, 1, 2, 3, 4].map((i) => (
        <group key={i} rotation={[0, (i * Math.PI * 2) / 5, 0]}>
          <mesh position={[0.17, 0.045, 0]} castShadow>
            <boxGeometry args={[0.32, 0.03, 0.055]} />
            <meshStandardMaterial color={metal} metalness={0.55} roughness={0.35} />
          </mesh>
          <mesh position={[0.32, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.035, 0.035, 0.045, 12]} />
            <meshStandardMaterial color="#111" metalness={0.4} roughness={0.4} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.04, 0.34, 12]} />
        <meshStandardMaterial color={metal} metalness={0.5} roughness={0.32} />
      </mesh>
      <RoundedBox args={[0.5, 0.07, 0.5]} radius={0.04} position={[0.04, 0.44, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={leather} roughness={0.7} />
      </RoundedBox>
      <RoundedBox
        args={[0.08, 0.52, 0.48]}
        radius={0.04}
        position={[-0.18, 0.74, 0]}
        rotation={[0, 0, 0.08]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={leather} roughness={0.7} />
      </RoundedBox>
    </group>
  );
}

function Worker({ agent, activity }: { agent: Agent; activity: Activity }) {
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const leftHand = useRef<THREE.Group>(null);
  const rightHand = useRef<THREE.Group>(null);
  const color = useMemo(() => hexColor(agent.pigment), [agent.pigment]);
  const shirt = useMemo(() => color.clone().offsetHSL(0, -0.05, 0.07), [color]);
  const hair = useMemo(() => color.clone().offsetHSL(0.02, 0.04, -0.28), [color]);
  const skin = "#e6b894";

  const leftShoulder: [number, number, number] = [0.06, 0.46, 0.19];
  const rightShoulder: [number, number, number] = [0.06, 0.46, -0.19];
  const leftHome: [number, number, number] = [0.41, 0.31, 0.13];
  const rightHome: [number, number, number] = [0.44, 0.318, -0.24];

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
      torso.current.position.y = Math.sin(t * (busy ? 2.2 : 1.5)) * (busy ? 0.01 : 0.006);
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
      <mesh position={[0.2, -0.02, 0.1]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <capsuleGeometry args={[0.072, 0.26, 6, 14]} />
        <Cloth color="#2c2825" />
      </mesh>
      <mesh position={[0.2, -0.02, -0.1]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <capsuleGeometry args={[0.072, 0.26, 6, 14]} />
        <Cloth color="#2c2825" />
      </mesh>
      <mesh position={[0.36, -0.22, 0.1]} castShadow>
        <capsuleGeometry args={[0.064, 0.28, 6, 14]} />
        <Cloth color="#2c2825" />
      </mesh>
      <mesh position={[0.36, -0.22, -0.1]} castShadow>
        <capsuleGeometry args={[0.064, 0.28, 6, 14]} />
        <Cloth color="#2c2825" />
      </mesh>
      <RoundedBox args={[0.18, 0.05, 0.09]} radius={0.02} position={[0.44, -0.42, 0.1]} castShadow>
        <meshStandardMaterial color="#1c1814" roughness={0.6} />
      </RoundedBox>
      <RoundedBox args={[0.18, 0.05, 0.09]} radius={0.02} position={[0.44, -0.42, -0.1]} castShadow>
        <meshStandardMaterial color="#1c1814" roughness={0.6} />
      </RoundedBox>

      <group ref={torso}>
        <mesh position={[0.04, 0.3, 0]} castShadow>
          <capsuleGeometry args={[0.15, 0.34, 8, 16]} />
          <Cloth color={shirt} roughness={0.74} />
        </mesh>
        <mesh position={[0.05, 0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.12, 0.03, 10, 20]} />
          <Cloth color={shirt} roughness={0.7} />
        </mesh>

        <group ref={head} position={[0.08, 0.66, 0]}>
          <mesh scale={[0.96, 1.05, 0.92]} castShadow>
            <sphereGeometry args={[0.13, 28, 28]} />
            <meshStandardMaterial color={skin} roughness={0.52} />
          </mesh>
          <mesh position={[-0.02, 0.07, 0]} scale={[1.02, 0.72, 1.08]} castShadow>
            <sphereGeometry args={[0.132, 22, 18]} />
            <meshStandardMaterial color={hair} roughness={0.78} />
          </mesh>
          <mesh position={[0.08, 0.08, 0]} rotation={[0, 0, -0.7]} scale={[0.7, 0.22, 1]}>
            <sphereGeometry args={[0.1, 16, 12]} />
            <meshStandardMaterial color={hair} roughness={0.78} />
          </mesh>
          <mesh position={[0.105, 0.02, 0.052]}>
            <sphereGeometry args={[0.024, 12, 12]} />
            <meshStandardMaterial color="#fbf7f2" />
          </mesh>
          <mesh position={[0.105, 0.02, -0.052]}>
            <sphereGeometry args={[0.024, 12, 12]} />
            <meshStandardMaterial color="#fbf7f2" />
          </mesh>
          <mesh position={[0.122, 0.02, 0.052]}>
            <sphereGeometry args={[0.012, 10, 10]} />
            <meshStandardMaterial color="#1c1814" />
          </mesh>
          <mesh position={[0.122, 0.02, -0.052]}>
            <sphereGeometry args={[0.012, 10, 10]} />
            <meshStandardMaterial color="#1c1814" />
          </mesh>
          <mesh position={[0.128, -0.01, 0]}>
            <boxGeometry args={[0.03, 0.028, 0.022]} />
            <meshStandardMaterial color="#d9a07e" roughness={0.55} />
          </mesh>
          <mesh position={[0.02, 0.01, 0.12]} scale={[0.7, 1, 0.5]}>
            <sphereGeometry args={[0.028, 10, 10]} />
            <meshStandardMaterial color={skin} roughness={0.55} />
          </mesh>
          <mesh position={[0.02, 0.01, -0.12]} scale={[0.7, 1, 0.5]}>
            <sphereGeometry args={[0.028, 10, 10]} />
            <meshStandardMaterial color={skin} roughness={0.55} />
          </mesh>
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
        <RoundedBox args={[0.085, 0.032, 0.072]} radius={0.012} rotation={[0.2, 0.08, 0.05]} castShadow>
          <meshStandardMaterial color={skin} roughness={0.55} />
        </RoundedBox>
      </group>
      <group ref={rightHand} position={rightHome}>
        <RoundedBox args={[0.078, 0.03, 0.058]} radius={0.012} rotation={[0.2, -0.1, -0.08]} castShadow>
          <meshStandardMaterial color={skin} roughness={0.55} />
        </RoundedBox>
      </group>
    </group>
  );
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

  useMemo(() => {
    if (keys.ctx) paintKeys(keys.ctx);
    keys.texture.needsUpdate = true;
  }, [keys]);

  useFrame((state) => {
    if (screen.ctx) {
      paintScreen(screen.ctx, activity, agent.pigment, state.clock.elapsedTime, feed);
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
          <meshStandardMaterial color="#1c1814" metalness={0.35} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.16, 0]} castShadow>
          <cylinderGeometry args={[0.018, 0.024, 0.28, 10]} />
          <meshStandardMaterial color="#1c1814" metalness={0.4} roughness={0.35} />
        </mesh>
        <group position={[0, 0.4, 0]}>
          <RoundedBox args={[0.045, 0.36, 0.58]} radius={0.012} castShadow>
            <meshStandardMaterial color="#1b1a18" metalness={0.45} roughness={0.32} />
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
          <meshStandardMaterial color="#2f2b28" roughness={0.55} />
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
      <CornerPlant position={[-1.2, 0, -1.45]} />
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
      <group rotation={[0, room ? 0.36 : 0.12, 0]}>
        <group position={[0.08, 0, 0]}>
          <OfficeChair />
        </group>
        <Worker agent={agent} activity={activity} />
        <Desk agent={agent} activity={activity} feed={feed} />
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
        : { position: [0.22, 1.55, 2.72] as [number, number, number], fov: 32, near: 0.08, far: 160 },
    [preview]
  );
  const lookAt = useMemo<[number, number, number]>(
    () => (preview ? [0.55, 0.86, 0] : [0.72, 0.74, 0]),
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
          <ambientLight intensity={night ? 0.1 : 0.3} />
          <hemisphereLight args={night ? ["#3a2e24", "#0c0a09", 0.24] : ["#fff6ea", "#c4b49a", 0.48]} />
          <directionalLight
            position={[-2.8, 5.4, 1.4]}
            intensity={night ? 0.14 : 1.45}
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
          <Station agent={agent} activity={activity} feed={feed} night={night} />
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
            <p className="mb-1 text-xs text-[var(--ink-soft)]">Drag to look · right-drag to pan · scroll to zoom</p>
          )}
        </div>
      </div>
    </WebGLFallback>
  );
}
