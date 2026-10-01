"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette, SMAA } from "@react-three/postprocessing";
import * as THREE from "three";
import { SceneQuality } from "@/lib/types";

export function CameraDirector({
  position,
  lookAt,
}: {
  position: [number, number, number];
  lookAt: [number, number, number];
}) {
  const { camera, controls } = useThree();
  const look = useRef(new THREE.Vector3(...lookAt));
  const goal = useRef(new THREE.Vector3(...position));
  const active = useRef(true);

  useEffect(() => {
    goal.current.set(position[0], position[1], position[2]);
    look.current.set(lookAt[0], lookAt[1], lookAt[2]);
    active.current = true;
  }, [position[0], position[1], position[2], lookAt[0], lookAt[1], lookAt[2]]);

  useEffect(() => {
    const orbit = controls as
      | {
          addEventListener?: (type: string, fn: () => void) => void;
          removeEventListener?: (type: string, fn: () => void) => void;
        }
      | undefined;
    if (!orbit?.addEventListener) return;
    const stop = () => {
      active.current = false;
    };
    orbit.addEventListener("start", stop);
    return () => orbit.removeEventListener?.("start", stop);
  }, [controls]);

  useFrame((_, dt) => {
    if (!active.current) return;
    const k = 1 - Math.exp(-6.2 * dt);
    camera.position.lerp(goal.current, k);
    const orbit = controls as { target?: THREE.Vector3; update?: () => void } | undefined;
    if (orbit?.target) {
      orbit.target.lerp(look.current, k);
      orbit.update?.();
    } else {
      camera.lookAt(look.current);
    }
    if (camera.position.distanceTo(goal.current) < 0.06) {
      camera.position.copy(goal.current);
      if (orbit?.target) orbit.target.copy(look.current);
      active.current = false;
    }
  });
  return null;
}

export function PostFX({ quality, diorama }: { quality: SceneQuality; diorama?: boolean }) {
  if (quality === "low" || quality === "off") return null;
  return (
    <EffectComposer enableNormalPass={false} multisampling={0}>
      <SMAA />
      {quality === "high" && <Bloom luminanceThreshold={1.2} intensity={diorama ? 0.18 : 0.16} mipmapBlur />}
      <Vignette eskil={false} offset={0.42} darkness={diorama ? 0.16 : 0.1} />
    </EffectComposer>
  );
}
