"use client";

import { Suspense, useLayoutEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { useFactory } from "@/lib/factory";
import { Activity } from "@/lib/types";
import { Station, WebGLFallback, FreeOrbit } from "../WorkerCanvas";
import { OfficeScene } from "../OfficeCanvas";
import { CameraDirector, PostFX } from "./PostFX";
import { IsoOffice } from "./IsoOffice";
import { GAP_X, GAP_Z, deskSlots, dioramaView } from "./layout";

function DioramaRig({
  position,
  lookAt,
  fov,
}: {
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  useLayoutEffect(() => {
    camera.position.set(position[0], position[1], position[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
    const persp = camera as THREE.PerspectiveCamera;
    if (persp.isPerspectiveCamera) {
      persp.fov = fov;
      persp.near = 0.2;
      persp.far = 160;
      persp.aspect = size.width / Math.max(size.height, 1);
      persp.updateProjectionMatrix();
    }
  }, [camera, size.width, size.height, position[0], position[1], position[2], lookAt[0], lookAt[1], lookAt[2], fov]);

  return null;
}

function readShot() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("shot");
}

export function SceneRoot({ className }: { className?: string }) {
  const { agents, live, selectedId, stageMode, chains, showroom, shift, plant, quality, select, openPreview } =
    useFactory();
  const night = Boolean(shift?.open);
  const agent = agents.find((a) => a.id === selectedId) || agents[0];
  const job = agent ? live[agent.id]?.job : undefined;
  const activity = (job?.activity || "idle") as Activity;
  const feed = (live[agent?.id || ""]?.tokens || job?.output || "").trim();
  const n = Math.max(agents.length, 1);
  const { cols, rows } = deskSlots(n);
  const width = Math.max(cols * GAP_X, 8.2);
  const depth = Math.max(rows * GAP_Z + 3.4, 10.5);
  const cx = width / 2 - GAP_X / 2;
  const shot = readShot();

  const officeCam = useMemo<[number, number, number]>(() => [cx + 4.2, 3.15, depth + 5.4], [cx, depth]);
  const deskCam = useMemo<[number, number, number]>(() => {
    if (shot === "face") return [1.18, 1.14, 0.08];
    if (shot === "front") return [1.42, 0.9, 0.7];
    if (shot === "legs") return [1.05, 0.26, 0.78];
    if (shot === "side") return [0.48, 0.82, 1.48];
    return [1.52, 1.36, 2.18];
  }, [agent?.id, shot]);
  const officeLook = useMemo<[number, number, number]>(() => [cx, 0.9, depth * 0.42], [cx, depth]);
  const deskLook = useMemo<[number, number, number]>(() => {
    if (shot === "face") return [0.32, 1.08, 0];
    if (shot === "front") return [0.28, 0.76, 0];
    if (shot === "legs") return [0.4, 0.14, 0.02];
    if (shot === "side") return [0.26, 0.7, 0];
    return [0.22, 1.04, 0.02];
  }, [agent?.id, shot]);
  const cam = stageMode === "desk" ? deskCam : officeCam;
  const look = stageMode === "desk" ? deskLook : officeLook;

  if (quality === "off") {
    return (
      <div className={`relative min-h-0 w-full ${className || "h-full"}`}>
        <IsoOffice agents={agents} />
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
          key={stageMode === "desk" ? `desk-${agent?.id}` : "office"}
          className="absolute inset-0 h-full w-full"
          shadows={quality !== "low"}
          camera={{ position: cam, fov: stageMode === "desk" ? 34 : 36, near: 0.08, far: 280 }}
          dpr={quality === "high" ? [1, 1.5] : [1, 1.25]}
          style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
          gl={{
            antialias: true,
            alpha: false,
            toneMapping: THREE.ACESFilmicToneMapping,
            powerPreference: "high-performance",
          }}
        >
          <PerformanceMonitor onDecline={() => undefined} />
          <Suspense fallback={null}>
            <Environment resolution={quality === "high" ? 256 : 128}>
              <Lightformer intensity={night ? 0.4 : 1.6} rotation-x={Math.PI / 2} position={[0, 5, 0]} scale={[12, 12, 1]} />
              <Lightformer intensity={0.6} position={[-6, 1, 2]} scale={[4, 6, 1]} color="#ffe2b8" />
            </Environment>
            <CameraDirector position={cam} lookAt={look} />
            {stageMode === "desk" && agent ? (
              <>
                <color attach="background" args={[night ? "#12100e" : "#d9cbb8"]} />
                <Station key={agent.id} agent={agent} activity={activity} feed={feed} night={night} room />
                <ContactShadows frames={1} position={[0, 0.01, 0]} opacity={0.34} scale={9} blur={2.4} far={5} />
                <FreeOrbit lookAt={look} minDistance={0.7} maxDistance={8} />
              </>
            ) : (
              <OfficeScene
                agents={agents}
                live={live}
                selectedId={selectedId}
                chains={chains}
                showroom={showroom}
                night={night}
                plant={plant}
                onSelect={select}
                onPreview={openPreview}
              />
            )}
            <PostFX quality={quality} />
          </Suspense>
        </Canvas>
      </div>
    </WebGLFallback>
  );
}

export function DioramaCanvas() {
  const { agents, live, selectedId, chains, showroom, shift, plant, quality, select, openPreview } = useFactory();
  const night = Boolean(shift?.open);
  const n = Math.max(agents.length, 1);
  const { cols, rows } = deskSlots(n);
  const width = Math.max(cols * GAP_X, 8.2);
  const depth = Math.max(rows * GAP_Z + 3.4, 10.5);
  const view = useMemo(() => dioramaView(width, depth), [width, depth]);

  if (quality === "off") return <IsoOffice agents={agents} />;

  return (
    <WebGLFallback fallback={<IsoOffice agents={agents} />}>
      <Canvas
        className="h-full w-full"
        style={{ pointerEvents: "none" }}
        frameloop="always"
        shadows
        dpr={[1, 1.5]}
        camera={{ position: view.position, fov: view.fov, near: 0.2, far: 160 }}
        gl={{
          antialias: true,
          alpha: false,
          toneMapping: THREE.ACESFilmicToneMapping,
          powerPreference: "low-power",
        }}
        onCreated={({ camera }) => {
          camera.position.set(view.position[0], view.position[1], view.position[2]);
          camera.lookAt(view.lookAt[0], view.lookAt[1], view.lookAt[2]);
        }}
      >
        <Suspense fallback={null}>
          <DioramaRig position={view.position} lookAt={view.lookAt} fov={view.fov} />
          <OfficeScene
            agents={agents}
            live={live}
            selectedId={selectedId}
            chains={chains}
            showroom={showroom}
            night={night}
            plant={plant}
            onSelect={select}
            onPreview={openPreview}
            orbit={false}
            diorama
          />
          <PostFX quality={quality === "high" ? "medium" : quality} diorama />
        </Suspense>
      </Canvas>
    </WebGLFallback>
  );
}
