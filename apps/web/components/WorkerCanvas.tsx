"use client";

import { Component, ReactNode, RefObject, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, OrbitControls, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { Agent, Activity, strengthLabel } from "@/lib/types";

class WebGLFallback extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

function hexColor(hex: string) {
  try {
    return new THREE.Color(hex);
  } catch {
    return new THREE.Color("#d46a3a");
  }
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

function activityLabel(activity: Activity) {
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

  const coding = agent.strengths.includes("coding");
  const maths = agent.strengths.includes("maths");
  const research = agent.strengths.includes("research");
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

      <group position={[1.18, 0.76, -0.02]} rotation={[0, 0.48, 0]}>
        <mesh position={[0, 0.02, 0]} castShadow>
          <boxGeometry args={[0.18, 0.02, 0.18]} />
          <meshStandardMaterial color="#2a2623" metalness={0.35} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.14, 0]} castShadow>
          <cylinderGeometry args={[0.02, 0.028, 0.24, 10]} />
          <meshStandardMaterial color="#2a2623" metalness={0.4} roughness={0.35} />
        </mesh>
        <group position={[0, 0.42, 0]} rotation={[0, 0, -0.06]}>
          <RoundedBox args={[0.05, 0.38, 0.62]} radius={0.015} castShadow>
            <meshStandardMaterial color="#1b1a18" metalness={0.45} roughness={0.32} />
          </RoundedBox>
          <mesh position={[-0.028, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
            <planeGeometry args={[0.56, 0.33]} />
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
        <pointLight ref={glow} position={[-0.22, 0.22, 0]} distance={1.2} intensity={0.12} color={color} />
      </group>

      <group position={[0.63, 0.761, 0.13]}>
        <mesh position={[0, 0.012, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.16, 0.02, 0.32]} />
          <meshStandardMaterial color="#2f2b28" roughness={0.55} />
        </mesh>
        <group rotation={[0, Math.PI / 2, 0]}>
          <mesh position={[0, 0.023, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[0.3, 0.145]} />
            <meshStandardMaterial map={keys.texture} roughness={0.42} />
          </mesh>
        </group>
      </group>
      <mesh position={[0.66, 0.762, -0.24]} receiveShadow>
        <boxGeometry args={[0.12, 0.006, 0.14]} />
        <meshStandardMaterial color="#7a5c45" roughness={0.9} />
      </mesh>
      <group position={[0.66, 0.78, -0.24]} rotation={[0.12, 0.15, 0]}>
        <RoundedBox args={[0.1, 0.03, 0.062]} radius={0.016} castShadow>
          <meshStandardMaterial color="#4a4038" roughness={0.34} />
        </RoundedBox>
        <mesh position={[0.012, 0.017, 0]}>
          <boxGeometry args={[0.03, 0.007, 0.01]} />
          <meshStandardMaterial color="#1c1814" roughness={0.4} />
        </mesh>
      </group>

      <group position={[1.22, 0.76, 0.48]}>
        <mesh position={[0, 0.07, 0]} castShadow>
          <cylinderGeometry args={[0.045, 0.038, 0.12, 16]} />
          <meshStandardMaterial color={color} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.13, 0]}>
          <cylinderGeometry args={[0.048, 0.045, 0.02, 16]} />
          <meshStandardMaterial color="#f4efe6" roughness={0.4} />
        </mesh>
        <mesh position={[0.055, 0.07, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.035, 0.01, 8, 16, Math.PI]} />
          <meshStandardMaterial color={color} roughness={0.45} />
        </mesh>
      </group>

      {coding && (
        <mesh position={[1.22, 0.78, 0.32]} rotation={[0, 0.4, 0]} castShadow>
          <boxGeometry args={[0.14, 0.02, 0.2]} />
          <meshStandardMaterial color="#1c1814" metalness={0.35} roughness={0.4} />
        </mesh>
      )}
      {maths && (
        <RoundedBox args={[0.28, 0.22, 0.01]} radius={0.008} position={[1.28, 0.92, -0.48]} rotation={[0, 0.6, 0]}>
          <meshStandardMaterial color="#fbf8f1" />
        </RoundedBox>
      )}
      {research && (
        <group position={[1.08, 0.78, -0.48]}>
          <mesh rotation={[0, 0.25, 0]} castShadow>
            <boxGeometry args={[0.16, 0.02, 0.22]} />
            <meshStandardMaterial color="#f4efe4" />
          </mesh>
          <mesh position={[0.03, 0.02, 0.02]} rotation={[0, -0.12, 0]} castShadow>
            <boxGeometry args={[0.16, 0.02, 0.22]} />
            <meshStandardMaterial color="#e7d7c2" />
          </mesh>
        </group>
      )}
    </group>
  );
}

function Room({ pigment }: { pigment: string }) {
  const rug = useMemo(() => hexColor(pigment).offsetHSL(0, -0.2, 0.28), [pigment]);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.5, 0, 0]} receiveShadow>
        <planeGeometry args={[9, 9]} />
        <meshStandardMaterial color="#e9e0d1" roughness={0.92} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.45, 0.004, 0]} receiveShadow>
        <circleGeometry args={[1.55, 48]} />
        <meshStandardMaterial color={rug} roughness={0.9} />
      </mesh>
      <mesh position={[-1.55, 1.4, 0]} receiveShadow>
        <boxGeometry args={[0.08, 2.8, 6]} />
        <meshStandardMaterial color="#f3eee6" roughness={0.9} />
      </mesh>
      <mesh position={[0.6, 1.4, -1.85]} receiveShadow>
        <boxGeometry args={[4.4, 2.8, 0.08]} />
        <meshStandardMaterial color="#efe8dc" roughness={0.9} />
      </mesh>
      <RoundedBox args={[1.72, 1.28, 0.06]} radius={0.02} position={[0.55, 1.55, -1.8]}>
        <meshStandardMaterial color="#d7c4a6" roughness={0.65} />
      </RoundedBox>
      <mesh position={[0.55, 1.55, -1.768]}>
        <planeGeometry args={[1.5, 1.06]} />
        <meshBasicMaterial color="#c5d8ea" />
      </mesh>
      <mesh position={[0.55, 1.55, -1.76]}>
        <boxGeometry args={[0.04, 1.06, 0.02]} />
        <meshStandardMaterial color="#d7c4a6" roughness={0.65} />
      </mesh>
      <mesh position={[0.55, 1.55, -1.76]}>
        <boxGeometry args={[1.5, 0.04, 0.02]} />
        <meshStandardMaterial color="#d7c4a6" roughness={0.65} />
      </mesh>
    </group>
  );
}

function Station({ agent, activity, feed }: { agent: Agent; activity: Activity; feed?: string }) {
  return (
    <group>
      <Room pigment={agent.pigment} />
      <group rotation={[0, 0.36, 0]}>
        <group position={[0.22, 0, 0]}>
          <OfficeChair />
        </group>
        <Worker agent={agent} activity={activity} />
        <Desk agent={agent} activity={activity} feed={feed} />
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
}: {
  agent: Agent;
  activity: Activity;
  feed?: string;
  className?: string;
  mode?: "stage" | "preview";
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) {
    return (
      <div className={`${className || ""} flex items-center justify-center text-[var(--ink-soft)]`}>
        Opening the desk…
      </div>
    );
  }
  const strengths = agent.strengths.map(strengthLabel).join(" · ") || "General";
  const preview = mode === "preview";
  const camera = preview
    ? { position: [2.2, 1.92, 3.45] as [number, number, number], fov: 40 }
    : { position: [0.42, 1.48, 2.52] as [number, number, number], fov: 34 };
  return (
    <WebGLFallback
      fallback={
        <div className={`${className || "h-full w-full"} flex items-center justify-center text-[var(--ink-soft)]`}>
          WebGL is unavailable. The inspector still runs the job.
        </div>
      }
    >
      <div className={`relative min-h-0 w-full ${className || "h-full"}`}>
        <Canvas
          className="absolute inset-0 h-full w-full"
          shadows="soft"
          camera={camera}
          style={{ width: "100%", height: "100%", display: "block" }}
          gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping }}
          onCreated={({ gl }) => {
            gl.toneMappingExposure = 1.05;
          }}
        >
          <color attach="background" args={["#efe8dc"]} />
          <ambientLight intensity={0.38} />
          <hemisphereLight args={["#fff6ea", "#c9bba8", 0.55]} />
          <directionalLight
            position={[2.8, 5.2, 1.6]}
            intensity={1.35}
            color="#fff3dc"
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-bias={-0.00025}
            shadow-camera-near={0.5}
            shadow-camera-far={14}
            shadow-camera-left={-3.5}
            shadow-camera-right={3.5}
            shadow-camera-top={3.5}
            shadow-camera-bottom={-3.5}
          />
          <directionalLight position={[-1.5, 2.2, -2.4]} intensity={0.45} color="#ffe7b0" />
          <Station agent={agent} activity={activity} feed={feed} />
          <ContactShadows position={[0, 0.001, 0]} opacity={0.38} scale={8} blur={2.6} far={4} />
          <OrbitControls
            enablePan={false}
            minDistance={preview ? 3.2 : 2.1}
            maxDistance={preview ? 6.8 : 5.2}
            minPolarAngle={0.7}
            maxPolarAngle={Math.PI / 2.12}
            target={preview ? [0.55, 0.86, 0] : [0.7, 0.68, 0]}
          />
        </Canvas>
        <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-end justify-between gap-3">
          <div className="rounded-2xl bg-white/92 px-4 py-3 shadow-sm">
            <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--ink-soft)]">
              {agent.name} · {strengths}
            </p>
            <p className="mt-1 text-sm font-medium">{activityLabel(activity)}</p>
          </div>
          {!preview && (
            <p className="mb-1 text-xs text-[var(--ink-soft)]">Drag to look around</p>
          )}
        </div>
      </div>
    </WebGLFallback>
  );
}
