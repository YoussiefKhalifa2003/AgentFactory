"use client";
import { RefObject, useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import type { Activity, Agent } from "@/lib/types";

const OBJ_URL = "/characters/hamza/vexel-simplified.obj";
const TEX = ["skin", "hair", "shirt", "jeans", "red", "white", "black", "mouth", "iris", "lip", "beard"] as const;
const SCALE = 0.44;
const SKIN = "#e2a06c";
const SHIRT = "#101018";
const FLOOR_Y = 0.048;
const SIT_THIGH = -1.18;
const SIT_SHIN = 1.42;

const PIVOT = {
  hips: [0, 0.01, 1.02],
  head: [0, -0.02, 2.18],
  leftHip: [-0.17, 0.01, 1.05],
  rightHip: [0.17, 0.01, 1.05],
  leftKnee: [-0.24, 0.025, 0.65],
  rightKnee: [0.24, 0.025, 0.65],
  leftFoot: [-0.33, -0.13, 0.105],
  rightFoot: [0.32, -0.13, 0.105],
} as const;

const MESH_OFFSET: [number, number, number] = [-0.02, -0.35, 0];
const LEFT_SHOULDER: [number, number, number] = [0.02, 0.42, 0.15];
const RIGHT_SHOULDER: [number, number, number] = [0.02, 0.42, -0.15];
const LEFT_HOME: [number, number, number] = [0.41, 0.31, 0.13];
const RIGHT_HOME: [number, number, number] = [0.44, 0.318, -0.24];

export function isHamzaAgent(agent: { name?: string }) {
  return (agent.name || "").trim().toLowerCase() === "hamza";
}

function vec(p: readonly number[]) {
  return new THREE.Vector3(p[0], p[1], p[2]);
}

function token(node: THREE.Object3D) {
  const bits: string[] = [];
  let cur: THREE.Object3D | null = node;
  while (cur) {
    if (cur.name) bits.push(cur.name.toLowerCase());
    cur = cur.parent;
  }
  return bits.join(" ");
}

function shouldHide(node: THREE.Object3D) {
  const n = token(node);
  return n.includes("wave_") || n.includes("relaxed_");
}

function isLettering(node: THREE.Object3D) {
  const n = token(node);
  return n.includes("laghari") || n.includes("lettering");
}

function matKeyFor(mesh: THREE.Mesh): (typeof TEX)[number] {
  const n = token(mesh);
  if (isLettering(mesh)) return "white";
  if (n.includes("beard") || n.includes("moustache")) return "beard";
  if (n.includes("hair") || n.includes("swept") || n.includes("eyebrow")) return "hair";
  if (n.includes("shirt")) return "shirt";
  if (n.includes("jean")) return "jeans";
  if (n.includes("mouth") || n.includes("smile_open")) return "mouth";
  if (n.includes("lip")) return "lip";
  if (n.includes("iris")) return "iris";
  if (n.includes("pupil") || n.includes("glasses")) return "black";
  if (
    n.includes("teeth") ||
    n.includes("tooth") ||
    n.includes("eye_white") ||
    n.includes("sparkle") ||
    n.includes("sole") ||
    n.includes("toe") ||
    n.includes("lace")
  )
    return "white";
  if (n.includes("shoe")) return "red";
  const mat = ((mesh.material as THREE.Material | undefined)?.name || "").toLowerCase();
  if ((TEX as readonly string[]).includes(mat)) return mat as (typeof TEX)[number];
  return "skin";
}

type Rig = {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  leftThigh: THREE.Group;
  rightThigh: THREE.Group;
  leftShin: THREE.Group;
  rightShin: THREE.Group;
  leftFoot: THREE.Group;
  rightFoot: THREE.Group;
};

function makePivot(parent: THREE.Object3D, name: string, world: THREE.Vector3) {
  const g = new THREE.Group();
  g.name = name;
  parent.add(g);
  parent.updateMatrixWorld(true);
  const local = world.clone();
  parent.worldToLocal(local);
  g.position.copy(local);
  return g;
}

function paintLettering(mesh: THREE.Mesh) {
  mesh.visible = true;
  mesh.material = new THREE.MeshStandardMaterial({
    color: "#f6f3ee",
    roughness: 0.38,
    metalness: 0.04,
    emissive: "#dedad3",
    emissiveIntensity: 0.42,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    depthWrite: true,
  });
  mesh.renderOrder = 2;
  mesh.position.y -= 0.014;
}

function paintMesh(mesh: THREE.Mesh, maps: Record<string, THREE.Texture>) {
  const matKey = matKeyFor(mesh);
  const map = maps[matKey];
  if (map) {
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
  }
  const shirt = matKey === "shirt";
  const denim = matKey === "jeans";
  const hair = matKey === "hair" || matKey === "beard";
  mesh.material = new THREE.MeshStandardMaterial({
    map: map || null,
    color: shirt ? SHIRT : map ? "#ffffff" : SKIN,
    roughness: shirt || denim ? 0.8 : hair ? 0.9 : 0.52,
    metalness: 0.02,
    name: matKey,
  });
}

function rigHamza(source: THREE.Group, maps: Record<string, THREE.Texture>): Rig {
  const root = source.clone(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    const hide = shouldHide(node);
    if (hide) node.visible = false;
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes.push(mesh);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (hide) {
      mesh.visible = false;
      return;
    }
    if (isLettering(mesh)) {
      paintLettering(mesh);
      return;
    }
    paintMesh(mesh, maps);
  });

  const named = (mesh: THREE.Mesh) => (mesh.name || mesh.parent?.name || "").toLowerCase();
  const take = (node: THREE.Object3D, prefixes: string[]) => {
    for (const mesh of meshes) {
      if (!mesh.visible) continue;
      const n = named(mesh);
      if (prefixes.some((p) => n === p || n.startsWith(`${p}_`) || n.startsWith(p))) node.attach(mesh);
    }
  };

  const hips = makePivot(root, "hips", vec(PIVOT.hips));
  const torso = makePivot(hips, "torso", vec(PIVOT.hips));
  take(torso, ["shirt_body", "laghari", "neck"]);

  const head = makePivot(torso, "head", vec(PIVOT.head));
  take(head, [
    "head",
    "ear",
    "hair",
    "swept",
    "fitted_beard",
    "face",
    "nose",
    "smile",
    "lower_lip",
    "moustache",
    "eye",
    "iris",
    "pupil",
    "eyebrow",
    "glasses",
  ]);

  const leftThigh = makePivot(hips, "leftThigh", vec(PIVOT.leftHip));
  const rightThigh = makePivot(hips, "rightThigh", vec(PIVOT.rightHip));
  take(leftThigh, ["left_thigh"]);
  take(rightThigh, ["right_thigh"]);

  const leftShin = makePivot(leftThigh, "leftShin", vec(PIVOT.leftKnee));
  const rightShin = makePivot(rightThigh, "rightShin", vec(PIVOT.rightKnee));
  take(leftShin, ["left_shin"]);
  take(rightShin, ["right_shin"]);

  const leftFoot = makePivot(leftShin, "leftFoot", vec(PIVOT.leftFoot));
  const rightFoot = makePivot(rightShin, "rightFoot", vec(PIVOT.rightFoot));
  leftFoot.userData.rest = leftFoot.position.clone();
  rightFoot.userData.rest = rightFoot.position.clone();
  take(leftFoot, ["left_shoe", "left_sole", "left_toe", "left_lace"]);
  take(rightFoot, ["right_shoe", "right_sole", "right_toe", "right_lace"]);
  take(hips, ["jeans_hips"]);

  return { root, torso, head, leftThigh, rightThigh, leftShin, rightShin, leftFoot, rightFoot };
}

function hangShin(shin: THREE.Group, foot: THREE.Group) {
  const rest = foot.userData.rest as THREE.Vector3 | undefined;
  if (rest) foot.position.copy(rest);
  shin.rotation.x = SIT_SHIN;
  shin.rotation.z = 0;
  shin.scale.set(1, 1, 1);
  foot.scale.set(1, 1, 1);
  shin.updateMatrixWorld(true);
  const knee = new THREE.Vector3();
  const toe = new THREE.Vector3();
  shin.getWorldPosition(knee);
  foot.getWorldPosition(toe);
  let drop = knee.y - toe.y;
  if (drop < 0.1) {
    shin.rotation.x = -Math.abs(SIT_SHIN);
    shin.updateMatrixWorld(true);
    shin.getWorldPosition(knee);
    foot.getWorldPosition(toe);
    drop = knee.y - toe.y;
  }
  const k = drop > 0.04 ? THREE.MathUtils.clamp((knee.y - FLOOR_Y) / drop, 1, 3.2) : 1;
  shin.scale.setScalar(k);
  foot.scale.setScalar(1 / k);
}

function poseSit(rig: Rig) {
  rig.root.updateMatrixWorld(true);
  rig.leftThigh.rotation.x = SIT_THIGH;
  rig.rightThigh.rotation.x = SIT_THIGH;
  rig.leftThigh.rotation.z = 0.04;
  rig.rightThigh.rotation.z = -0.04;
  rig.leftThigh.updateMatrixWorld(true);
  rig.rightThigh.updateMatrixWorld(true);
  hangShin(rig.leftShin, rig.leftFoot);
  hangShin(rig.rightShin, rig.rightFoot);
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
  upperColor: string;
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
        <capsuleGeometry args={[0.056, restLen, 6, 12]} />
        <meshStandardMaterial color={upperColor} roughness={0.75} metalness={0.04} />
      </mesh>
      <mesh ref={lower} castShadow>
        <capsuleGeometry args={[0.044, restLen, 6, 12]} />
        <meshStandardMaterial color={lowerColor} roughness={0.75} metalness={0.04} />
      </mesh>
    </>
  );
}

export function HamzaWorker({
  activity,
  stand,
}: {
  agent: Agent;
  activity: Activity;
  stand?: boolean;
}) {
  const obj = useLoader(OBJLoader, OBJ_URL);
  const textures = useLoader(
    THREE.TextureLoader,
    TEX.map((name) => `/characters/hamza/textures/${name}.png`)
  );
  const maps = useMemo(() => {
    const out: Record<string, THREE.Texture> = {};
    TEX.forEach((name, i) => {
      out[name] = textures[i];
    });
    return out;
  }, [textures]);
  const rig = useMemo(() => rigHamza(obj, maps), [obj, maps]);
  const leftHand = useRef<THREE.Group>(null);
  const rightHand = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (rig.root.parent) {
      poseSit(rig);
    }

    const t = state.clock.elapsedTime;
    const busy = activity !== "idle" && activity !== "done" && activity !== "blocked";
    const typing = busy && activity !== "tool:web";
    const mousing = busy;
    const think = activity === "thinking";
    const done = activity === "done";
    const blocked = activity === "blocked";
    const web = activity === "tool:web";

    rig.torso.rotation.x = done ? -0.02 : blocked ? -0.08 : busy ? -0.05 : -0.04;
    rig.torso.position.z = (stand ? 0.01 : 0) + Math.sin(t * (busy ? 2.2 : 1.5)) * (busy ? 0.004 : 0.0025);

    if (think) {
      rig.head.rotation.x = -0.05 + Math.sin(t * 1.1) * 0.03;
      rig.head.rotation.z = 0.02;
    } else if (web) {
      rig.head.rotation.x = -0.04;
      rig.head.rotation.z = 0.01;
    } else if (done) {
      rig.head.rotation.x = -0.02;
      rig.head.rotation.z = Math.sin(t * 1.4) * 0.02;
    } else if (blocked) {
      rig.head.rotation.x = -0.08;
      rig.head.rotation.z = -0.03;
    } else {
      rig.head.rotation.x = -0.045;
      rig.head.rotation.z = 0;
    }

    if (leftHand.current) {
      leftHand.current.position.set(
        LEFT_HOME[0] + (typing ? Math.sin(t * 14) * 0.02 : 0),
        LEFT_HOME[1] + (typing ? Math.abs(Math.sin(t * 17)) * 0.014 : 0),
        LEFT_HOME[2] + (typing ? Math.sin(t * 11 + 0.8) * 0.028 : 0)
      );
    }
    if (rightHand.current) {
      const click = mousing && Math.sin(t * 8) > 0.55 ? 0.012 : 0;
      rightHand.current.position.set(
        RIGHT_HOME[0] + (mousing ? Math.sin(t * 4.6) * 0.012 : 0),
        RIGHT_HOME[1] + click,
        RIGHT_HOME[2] + (mousing ? Math.sin(t * 3.8 + 1.2) * 0.02 : 0)
      );
    }
  });

  return (
    <group position={[0.22, 0.47, 0]}>
      <group position={MESH_OFFSET} rotation={[0, Math.PI / 2, 0]}>
        <group rotation={[-Math.PI / 2, 0, 0]} scale={SCALE}>
          <primitive object={rig.root} />
        </group>
      </group>
      <ArmBones
        shoulder={LEFT_SHOULDER}
        handRef={leftHand}
        rest={LEFT_HOME}
        outZ={0.08}
        upperColor={SHIRT}
        lowerColor={SKIN}
      />
      <ArmBones
        shoulder={RIGHT_SHOULDER}
        handRef={rightHand}
        rest={RIGHT_HOME}
        outZ={-0.08}
        upperColor={SHIRT}
        lowerColor={SKIN}
      />
      <group ref={leftHand} position={LEFT_HOME}>
        <mesh castShadow>
          <sphereGeometry args={[0.038, 12, 12]} />
          <meshStandardMaterial color={SKIN} roughness={0.55} />
        </mesh>
      </group>
      <group ref={rightHand} position={RIGHT_HOME}>
        <mesh castShadow>
          <sphereGeometry args={[0.036, 12, 12]} />
          <meshStandardMaterial color={SKIN} roughness={0.55} />
        </mesh>
      </group>
    </group>
  );
}
