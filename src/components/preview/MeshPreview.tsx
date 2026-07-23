import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, OrbitControls, useBounds } from "@react-three/drei";
import * as THREE from "three";
import type { MeshPart } from "@/types/clothing";

/**
 * Isolated clothing-item 3D viewer: real decoded geometry (positions/
 * normals/UV0 from the sidecar) with the real decoded texture applied.
 * Deliberately does NOT attach to a base character mesh - see
 * docs/ROADMAP.md's Phase 3 section for why (Rockstar base-game content
 * this project cannot ship or generate).
 *
 * Lighting is procedural (key/fill/rim), not an image-based HDRI: an HDRI
 * preset would either need bundling a licensed .hdr asset or fetching one
 * from a CDN at runtime, and this app is meant to work fully offline. See
 * docs/ROADMAP.md.
 */
export function MeshPreview({
  parts,
  textureDataUrl,
  showBoneWeights = false,
}: {
  parts: MeshPart[];
  textureDataUrl?: string | null;
  showBoneWeights?: boolean;
}) {
  return (
    <Canvas camera={{ position: [1.2, 0.8, 1.2], fov: 40 }} dpr={[1, 2]}>
      <color attach="background" args={["#15171c"]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 4, 2]} intensity={1.1} />
      <directionalLight position={[-3, 1, -2]} intensity={0.35} color="#88aaff" />
      <directionalLight position={[0, -2, -3]} intensity={0.25} color="#ffddaa" />
      <Bounds fit clip observe margin={1.4}>
        <FramedParts parts={parts} textureDataUrl={textureDataUrl} showBoneWeights={showBoneWeights} />
      </Bounds>
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
    </Canvas>
  );
}

function FramedParts({
  parts,
  textureDataUrl,
  showBoneWeights,
}: {
  parts: MeshPart[];
  textureDataUrl?: string | null;
  showBoneWeights: boolean;
}) {
  return (
    <group>
      {parts.map((part, i) => (
        <PartMesh key={i} part={part} textureDataUrl={textureDataUrl} showBoneWeights={showBoneWeights} />
      ))}
    </group>
  );
}

/** Deterministic, visually distinct color per bone index (golden-angle hue rotation). */
function colorForBone(boneIndex: number): THREE.Color {
  const hue = (boneIndex * 137.508) % 360;
  return new THREE.Color().setHSL(hue / 360, 0.65, 0.55);
}

function PartMesh({
  part,
  textureDataUrl,
  showBoneWeights,
}: {
  part: MeshPart;
  textureDataUrl?: string | null;
  showBoneWeights: boolean;
}) {
  const bounds = useBounds();

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(part.positions, 3));
    if (part.uv0.length === part.vertexCount * 2) {
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(part.uv0, 2));
    }
    geo.setIndex(part.indices);

    const hasRealNormals = part.normals.some((n) => n !== 0);
    if (hasRealNormals && part.normals.length === part.vertexCount * 3) {
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(part.normals, 3));
    } else {
      // Decoded normals were all-zero (an absent vertex semantic, or a decode
      // gap this project couldn't verify against a real file - see
      // docs/FILE_FORMATS.md) - derive them from the triangle geometry
      // instead of rendering a flat-black, unlit-looking mesh.
      geo.computeVertexNormals();
    }

    if (part.dominantBoneIndex.length === part.vertexCount) {
      const colors = new Float32Array(part.vertexCount * 3);
      for (let v = 0; v < part.vertexCount; v++) {
        const c = colorForBone(part.dominantBoneIndex[v]);
        colors[v * 3] = c.r;
        colors[v * 3 + 1] = c.g;
        colors[v * 3 + 2] = c.b;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }

    return geo;
  }, [part]);

  const texture = useMemo(() => {
    if (!textureDataUrl) return null;
    const tex = new THREE.TextureLoader().load(textureDataUrl, () => bounds.refresh().fit());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    return tex;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textureDataUrl]);

  const hasBoneColors = part.dominantBoneIndex.length === part.vertexCount;

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      {showBoneWeights && hasBoneColors ? (
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.9} />
      ) : texture ? (
        <meshStandardMaterial map={texture} side={THREE.DoubleSide} roughness={0.85} metalness={0.05} />
      ) : (
        <meshStandardMaterial color="#7d8590" side={THREE.DoubleSide} roughness={0.9} />
      )}
    </mesh>
  );
}
