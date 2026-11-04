"use client";

/**
 * Thousands of soft particles arranged as concentric rings: you at the warm
 * centre, layers of protection around you. A second, smaller ring (your
 * trusted contact) and the thread between you appear in the "can’t act"
 * chapter. One draw call per Points object; all motion runs in the shader.
 */

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CHAPTER_TARGETS, story } from "@/lib/story";

const RINGS = [
  { radius: 0.32, count: 260, color: "#FFF1D6", speed: 0.05 }, // warm core
  { radius: 0.78, count: 1100, color: "#9FD2B0", speed: 0.035 },
  { radius: 1.26, count: 1600, color: "#9ED3CF", speed: -0.025 },
  { radius: 1.78, count: 2200, color: "#BFE6BC", speed: 0.018 },
];

const CONTACT_CENTER = new THREE.Vector3(1.55, -1.05, 0.2);

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uSpread;
  uniform float uLink;
  uniform float uPixelRatio;
  attribute float aRadius;
  attribute float aAngle;
  attribute float aSpeed;
  attribute float aSeed;
  attribute float aKind;   // 0 main rings, 1 contact ring, 2 thread
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vRadius;

  void main() {
    float t = uTime;
    float breathe = 1.0 + 0.035 * sin(t * 0.9 - aRadius * 1.6);
    vec3 pos;

    if (aKind < 0.5) {
      float a = aAngle + t * aSpeed;
      float r = aRadius * breathe;
      r *= 1.0 + uSpread * (0.35 + aSeed * 1.4);
      float wobble = 0.045 * sin(a * 5.0 + t * 0.7 + aSeed * 6.28);
      pos = vec3(cos(a) * (r + wobble), sin(a) * (r + wobble), (aSeed - 0.5) * (0.28 + uSpread * 2.2));
      vAlpha = 0.85;
    } else if (aKind < 1.5) {
      float a = aAngle + t * aSpeed;
      float r = aRadius * breathe * (0.4 + 0.6 * uLink);
      pos = vec3(${CONTACT_CENTER.x.toFixed(2)} + cos(a) * r, ${CONTACT_CENTER.y.toFixed(2)} + sin(a) * r, ${CONTACT_CENTER.z.toFixed(2)} + (aSeed - 0.5) * 0.18);
      vAlpha = uLink;
    } else {
      // Thread from the outer ring toward the contact: particles drift along a gentle curve.
      float s = fract(aAngle + t * 0.06);
      vec3 a0 = normalize(vec3(${CONTACT_CENTER.x.toFixed(2)}, ${CONTACT_CENTER.y.toFixed(2)}, 0.0)) * 1.0;
      vec3 a1 = vec3(${CONTACT_CENTER.x.toFixed(2)}, ${CONTACT_CENTER.y.toFixed(2)}, ${CONTACT_CENTER.z.toFixed(2)});
      vec3 mid = mix(a0, a1, 0.5) + vec3(0.25, 0.35, 0.3);
      pos = mix(mix(a0, mid, s), mix(mid, a1, s), s);
      pos += (vec3(aSeed, fract(aSeed * 7.13), fract(aSeed * 3.7)) - 0.5) * 0.06;
      vAlpha = uLink * smoothstep(0.0, 0.15, s) * smoothstep(1.0, 0.85, s);
    }

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = aKind > 1.5 ? 5.0 : (aRadius < 0.4 ? 9.0 : 5.5);
    gl_PointSize = size * (0.6 + aSeed * 0.8) * uPixelRatio * (4.0 / -mv.z);
    vColor = aColor;
    vRadius = aRadius;
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uAmber;
  uniform float uDim;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vRadius;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float soft = smoothstep(0.5, 0.0, d);
    // A single amber ripple travels outward through the rings when something is paused.
    float wave = smoothstep(0.55, 1.0, sin(vRadius * 4.0 - uTime * 2.0) * 0.5 + 0.5);
    vec3 amber = vec3(0.914, 0.663, 0.290);
    vec3 col = mix(vColor, amber, uAmber * wave * step(0.5, vRadius) * 0.9);
    gl_FragColor = vec4(col, soft * vAlpha * (1.0 - uDim));
  }
`;

function hex(c: string): [number, number, number] {
  const v = new THREE.Color(c);
  return [v.r, v.g, v.b];
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function AuraRings({ density = 1 }: { density?: number }) {
  const group = useRef<THREE.Group>(null);
  const { viewport, gl, size } = useThree();

  const { geometry, material } = useMemo(() => {
    const rand = seeded(42);
    const radius: number[] = [];
    const angle: number[] = [];
    const speed: number[] = [];
    const seed: number[] = [];
    const kind: number[] = [];
    const color: number[] = [];

    const push = (r: number, a: number, sp: number, k: number, c: [number, number, number]) => {
      radius.push(r);
      angle.push(a);
      speed.push(sp);
      seed.push(rand());
      kind.push(k);
      color.push(...c);
    };

    for (const ring of RINGS) {
      const n = Math.round(ring.count * density);
      const c = hex(ring.color);
      for (let i = 0; i < n; i++) {
        const jitter = (rand() - 0.5) * (ring.radius < 0.4 ? 0.5 : 0.16);
        push(Math.max(0.02, ring.radius + jitter), rand() * Math.PI * 2, ring.speed * (0.8 + rand() * 0.4), 0, c);
      }
    }
    const contact = hex("#ACDBB8");
    for (let i = 0; i < Math.round(700 * density); i++) {
      push(0.42 + (rand() - 0.5) * 0.12, rand() * Math.PI * 2, 0.06, 1, contact);
    }
    const thread = hex("#FFE7BE");
    for (let i = 0; i < Math.round(420 * density); i++) {
      push(1, rand(), 0, 2, thread);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Array(radius.length * 3).fill(0), 3));
    g.setAttribute("aRadius", new THREE.Float32BufferAttribute(radius, 1));
    g.setAttribute("aAngle", new THREE.Float32BufferAttribute(angle, 1));
    g.setAttribute("aSpeed", new THREE.Float32BufferAttribute(speed, 1));
    g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
    g.setAttribute("aKind", new THREE.Float32BufferAttribute(kind, 1));
    g.setAttribute("aColor", new THREE.Float32BufferAttribute(color, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);

    const m = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uSpread: { value: 0 },
        uAmber: { value: 0 },
        uLink: { value: 0 },
        uDim: { value: 0 },
        uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
      },
    });
    return { geometry: g, material: m };
  }, [density, gl]);

  const xPos = useRef(1);
  const tilt = useRef({ x: 0, y: 0 });

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const u = material.uniforms;
    const target = CHAPTER_TARGETS[story.chapter];
    const k = 1 - Math.exp(-dt * 2.2); // smooth, inertial easing toward each chapter’s look

    if (!story.reducedMotion) u.uTime!.value += dt;
    u.uSpread!.value += (target.spread - u.uSpread!.value) * k;
    u.uAmber!.value += (target.amber - u.uAmber!.value) * k;
    u.uLink!.value += (target.link - u.uLink!.value) * k;
    const wide = size.width >= 900;
    const dimTarget = wide ? target.dim : Math.max(target.dim, 0.55);
    u.uDim!.value += (dimTarget - u.uDim!.value) * k;

    // On wide screens the rings sit to the right of the text; on narrow ones, centred behind it.
    xPos.current += ((wide ? target.x * viewport.width * 0.29 : 0) - xPos.current) * k;

    if (group.current) {
      const p = story.reducedMotion ? { x: 0, y: 0 } : story.pointer;
      tilt.current.x += (p.y * 0.28 - tilt.current.x) * (1 - Math.exp(-dt * 3));
      tilt.current.y += (p.x * 0.38 - tilt.current.y) * (1 - Math.exp(-dt * 3));
      group.current.rotation.set(tilt.current.x - 0.18, tilt.current.y, 0);
      group.current.position.x = xPos.current;
      const s = wide ? 0.92 : 0.78;
      group.current.scale.setScalar(s);
    }
  });

  return (
    <group ref={group}>
      <points geometry={geometry} material={material} />
    </group>
  );
}
