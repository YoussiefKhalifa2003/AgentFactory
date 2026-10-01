"use client";

import { RoundedBox } from "@react-three/drei";
import { Agent } from "@/lib/types";

function grounded(y = 0.76) {
  return y;
}

export function DeskDress({ agent }: { agent: Agent }) {
  const skills = agent.strengths || [];
  const first = skills[0] || "coding";
  return (
    <group>
      {first === "coding" && (
        <group position={[1.42, grounded(), 0.42]}>
          <RoundedBox args={[0.04, 0.28, 0.42]} radius={0.01} position={[0, 0.18, 0]} castShadow>
            <meshStandardMaterial color="#1b1a18" roughness={0.35} />
          </RoundedBox>
        </group>
      )}
      {first === "maths" && (
        <mesh position={[1.55, 1.35, -0.05]} rotation={[0, -0.2, 0]}>
          <planeGeometry args={[0.7, 0.5]} />
          <meshStandardMaterial color="#3d5344" roughness={0.9} />
        </mesh>
      )}
      {first === "research" && (
        <group position={[1.32, grounded(0.78), 0.48]}>
          <mesh castShadow>
            <boxGeometry args={[0.16, 0.04, 0.2]} />
            <meshStandardMaterial color="#efe4d2" roughness={0.8} />
          </mesh>
          <mesh position={[0.02, 0.04, 0.01]} castShadow>
            <boxGeometry args={[0.16, 0.04, 0.2]} />
            <meshStandardMaterial color="#e7d7c2" roughness={0.8} />
          </mesh>
        </group>
      )}
      {first === "writing" && (
        <mesh position={[0.92, grounded(0.79), 0.28]} castShadow>
          <boxGeometry args={[0.18, 0.06, 0.14]} />
          <meshStandardMaterial color="#2a2623" roughness={0.4} />
        </mesh>
      )}
      {first === "data" && (
        <mesh position={[1.38, 1.05, 0.36]} rotation={[0, -0.3, 0]}>
          <planeGeometry args={[0.36, 0.22]} />
          <meshStandardMaterial color="#1c242e" emissive="#1aa6b8" emissiveIntensity={0.2} />
        </mesh>
      )}
      {first === "planning" && (
        <mesh position={[1.55, 1.2, -0.35]} rotation={[0, -0.4, 0]}>
          <planeGeometry args={[0.5, 0.36]} />
          <meshStandardMaterial color="#f4efe6" />
        </mesh>
      )}
      {first === "ops" && (
        <mesh position={[1.28, grounded(0.79), 0.55]} castShadow>
          <boxGeometry args={[0.08, 0.04, 0.14]} />
          <meshStandardMaterial color="#1c1814" />
        </mesh>
      )}
      {first === "review" && (
        <mesh position={[0.9, grounded(0.772), 0.42]} rotation={[0, 0.2, 0]} castShadow>
          <cylinderGeometry args={[0.012, 0.012, 0.16, 8]} />
          <meshStandardMaterial color="#b42318" />
        </mesh>
      )}
      {first === "brief" && (
        <mesh position={[1.18, grounded(0.78), 0.5]} castShadow>
          <boxGeometry args={[0.08, 0.03, 0.12]} />
          <meshStandardMaterial color="#2a2623" />
        </mesh>
      )}
      {first === "qa" && (
        <mesh position={[1.34, grounded(0.82), 0.5]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.12, 12]} />
          <meshStandardMaterial color="#178a9a" roughness={0.3} transparent opacity={0.55} />
        </mesh>
      )}
      {skills.includes("drawio") && (
        <mesh position={[1.6, 1.15, 0.55]} rotation={[0, -0.5, 0]}>
          <planeGeometry args={[0.42, 0.28]} />
          <meshStandardMaterial color="#fffdf8" />
        </mesh>
      )}
      {skills.includes("pdf") && (
        <mesh position={[1.22, grounded(0.78), 0.62]} castShadow>
          <boxGeometry args={[0.12, 0.02, 0.16]} />
          <meshStandardMaterial color="#f2e6d4" />
        </mesh>
      )}
      {skills.includes("slides") && (
        <mesh position={[1.48, 1.08, -0.55]} rotation={[0.1, 0.4, 0]}>
          <boxGeometry args={[0.22, 0.02, 0.14]} />
          <meshStandardMaterial color="#1c1814" />
        </mesh>
      )}
      {skills.includes("spreadsheet") && (
        <mesh position={[1.08, grounded(0.775), 0.58]} castShadow>
          <boxGeometry args={[0.14, 0.015, 0.18]} />
          <meshStandardMaterial color="#2f7d4a" />
        </mesh>
      )}
    </group>
  );
}
