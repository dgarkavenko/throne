import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
  DoubleSide,
} from 'three';
import type { TerrainGenerationState } from '../../terrain/types';
import {
  DEFAULT_TERRAIN_RENDER_CONTROLS,
  fingerprintTerrainRenderControls,
  hasRefinementControlChange,
  normalizeTerrainRenderControls,
  type TerrainRenderControls,
} from './render-controls';

type TerrainBuffers = {
  positions: number[];
  faceElevation: number[];
  faceWaterMask: number[];
};

const LEGACY_WATER_COLOR = 0x0d1a2e;

export class ThreeJsRenderer {
  private renderer: WebGLRenderer | null = null;
  private scene: Scene = new Scene();
  private camera: PerspectiveCamera | null = null;
  private terrainRoot: Group = new Group();
  private mapCenter = new Vector3();
  private orbitRadius = 1;
  private orbitAngle = 0;

  private terrainMesh: Mesh | null = null;
  private waterHorizonMesh: Mesh | null = null;

  private renderControls: TerrainRenderControls = { ...DEFAULT_TERRAIN_RENDER_CONTROLS };

  async init(w: number, h: number, ratio: number, field: HTMLElement | null): Promise<void> {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(LEGACY_WATER_COLOR, 1);

    if (field) {
      field.appendChild(this.renderer.domElement);
    }

    this.camera = new PerspectiveCamera(this.renderControls.cameraFov, w / h, 0.1, 12000);

    this.scene.fog = new Fog(LEGACY_WATER_COLOR, 1400, 5200);
    this.scene.background = new Color(LEGACY_WATER_COLOR);
    this.scene.add(new AmbientLight(0xffffff, 0.58));

    const sun = new DirectionalLight(0xffffff, 0.62);
    sun.position.set(800, 1100, 400);
    this.scene.add(sun);

    this.scene.add(this.terrainRoot);
    this.startRenderLoop();
  }

  setTerrainRenderControls(next: TerrainRenderControls): { changed: boolean; refinementChanged: boolean } {
    const sanitized = normalizeTerrainRenderControls(next);
    const prev = this.renderControls;
    const changed = fingerprintTerrainRenderControls(prev) !== fingerprintTerrainRenderControls(sanitized);
    const refinementChanged = hasRefinementControlChange(prev, sanitized);
    this.renderControls = sanitized;

    if (this.camera) {
      this.camera.fov = sanitized.cameraFov;
      this.camera.updateProjectionMatrix();
    }

    return { changed, refinementChanged };
  }

  renderTerrainOnce(mapWidth: number, mapHeight: number, terrainState: TerrainGenerationState): void {
    this.disposeSceneMeshes();

    const buffers = buildTerrainMeshBuffers(terrainState);

    const terrainGeometry = new BufferGeometry();
    terrainGeometry.setAttribute('position', new Float32BufferAttribute(buffers.positions, 3));
    terrainGeometry.setAttribute('aFaceElevation', new Float32BufferAttribute(buffers.faceElevation, 1));
    terrainGeometry.setAttribute('aFaceWaterMask', new Float32BufferAttribute(buffers.faceWaterMask, 1));

    const terrainMaterial = new ShaderMaterial({
      side: DoubleSide,
      vertexShader: `
        attribute float aFaceElevation;
        attribute float aFaceWaterMask;

        varying float vFaceElevation;
        varying float vFaceWaterMask;

        void main() {
          vFaceElevation = aFaceElevation;
          vFaceWaterMask = aFaceWaterMask;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vFaceElevation;
        varying float vFaceWaterMask;

        void main() {
          if (vFaceWaterMask > 0.5) {
            float depth = clamp(-vFaceElevation, 0.0, 1.0);
            vec3 shallow = vec3(0.07, 0.15, 0.24);
            vec3 deep = vec3(0.03, 0.07, 0.13);
            gl_FragColor = vec4(mix(shallow, deep, depth), 1.0);
            return;
          }

          float t = clamp(vFaceElevation, 0.0, 1.0);
          vec3 low = vec3(0.24, 0.52, 0.24);
          vec3 high = vec3(0.80, 0.78, 0.74);
          gl_FragColor = vec4(mix(low, high, t), 1.0);
        }
      `,
    });

    this.terrainMesh = new Mesh(terrainGeometry, terrainMaterial);
    this.terrainRoot.add(this.terrainMesh);

    const horizonSize = Math.max(mapWidth, mapHeight) * 12;
    const waterGeometry = new PlaneGeometry(horizonSize, horizonSize, 1, 1);
    const waterMaterial = new ShaderMaterial({
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        void main() {
          vec3 legacy = vec3(0.05, 0.10, 0.18);
          vec3 horizon = vec3(0.11, 0.17, 0.28);
          float horizonMix = smoothstep(0.35, 1.0, distance(vUv, vec2(0.5)) * 1.8);
          gl_FragColor = vec4(mix(legacy, horizon, horizonMix), 0.84);
        }
      `,
    });

    this.waterHorizonMesh = new Mesh(waterGeometry, waterMaterial);
    this.waterHorizonMesh.rotation.x = -Math.PI * 0.5;
    this.waterHorizonMesh.position.set(mapWidth * 0.5, 1.5, mapHeight * 0.5);

    this.terrainRoot.add(this.waterHorizonMesh);
    this.terrainRoot.renderOrder = 2;
    if (this.waterHorizonMesh) {
      this.waterHorizonMesh.renderOrder = 4;
    }
    if (this.terrainMesh) {
      this.terrainMesh.renderOrder = 3;
    }

    this.mapCenter.set(mapWidth * 0.5, 0, mapHeight * 0.5);
    this.orbitRadius = Math.max(mapWidth, mapHeight) * 1.1;
    this.orbitAngle = 0;
  }

  rerenderProvinceBorders(): void {
    // not used in three.js terrain preview
  }

  private disposeSceneMeshes(): void {
    if (this.terrainMesh) {
      this.terrainRoot.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      const material = this.terrainMesh.material as ShaderMaterial;
      material.dispose();
      this.terrainMesh = null;
    }

    if (this.waterHorizonMesh) {
      this.terrainRoot.remove(this.waterHorizonMesh);
      this.waterHorizonMesh.geometry.dispose();
      const material = this.waterHorizonMesh.material as ShaderMaterial;
      material.dispose();
      this.waterHorizonMesh = null;
    }
  }

  private startRenderLoop(): void {
    const frame = (): void => {
      if (this.renderer && this.camera) {
        this.orbitAngle += 0.0018;
        this.camera.position.set(
          this.mapCenter.x + Math.cos(this.orbitAngle) * this.orbitRadius,
          this.orbitRadius * 0.33,
          this.mapCenter.z + Math.sin(this.orbitAngle) * this.orbitRadius
        );
        this.camera.lookAt(this.mapCenter.x, 80, this.mapCenter.z);
        this.renderer.render(this.scene, this.camera);
      }
      window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
  }
}

function buildTerrainMeshBuffers(terrainState: TerrainGenerationState): TerrainBuffers {
  const mesh = terrainState.mesh;
  const vertexElevation = terrainState.elevation.vertexElevation;
  const isLand = terrainState.water.isLand;
  const landDistance = terrainState.water.landDistance;

  const positions: number[] = [];
  const faceElevation: number[] = [];
  const faceWaterMask: number[] = [];

  const maxElevation = maxFinite(vertexElevation, 1);
  const maxDistance = maxFinite(landDistance, 1);
  const heightScale = 220 / maxElevation;
  const underwaterDepthScale = 140;

  const faceHeights = new Array<number>(mesh.faces.length).fill(0);
  for (let faceIndex = 0; faceIndex < mesh.faces.length; faceIndex += 1) {
    const face = mesh.faces[faceIndex];
    const baseElevation =
      face.vertices.reduce((sum, vertexIndex) => sum + finiteOr(vertexElevation[vertexIndex], 0), 0) /
      Math.max(1, face.vertices.length);

    if (isLand[faceIndex]) {
      faceHeights[faceIndex] = baseElevation * heightScale;
    } else {
      const distance = finiteOr(landDistance[faceIndex], maxDistance);
      const depthRatio = Math.pow(clamp01(distance / maxDistance), 1.08);
      faceHeights[faceIndex] = -underwaterDepthScale * depthRatio;
    }
  }

  for (let faceIndex = 0; faceIndex < mesh.faces.length; faceIndex += 1) {
    const face = mesh.faces[faceIndex];
    if (face.vertices.length < 3) {
      continue;
    }

    const isWaterFace = !isLand[faceIndex];

    for (let i = 0; i < face.vertices.length; i += 1) {
      const aIndex = face.vertices[i];
      const bIndex = face.vertices[(i + 1) % face.vertices.length];

      const aPoint = mesh.vertices[aIndex].point;
      const bPoint = mesh.vertices[bIndex].point;

      const centerY = faceHeights[faceIndex];
      const aY = averageVertexHeight(mesh.vertices[aIndex].faces, faceHeights);
      const bY = averageVertexHeight(mesh.vertices[bIndex].faces, faceHeights);

      positions.push(face.point.x, centerY, face.point.y);
      positions.push(aPoint.x, aY, aPoint.y);
      positions.push(bPoint.x, bY, bPoint.y);

      const faceElevationNormalized = isWaterFace
        ? -Math.min(1, Math.abs(finiteOr(centerY, 0)) / underwaterDepthScale)
        : Math.min(1, finiteOr(centerY, 0) / (heightScale * maxElevation));
      faceElevation.push(faceElevationNormalized, faceElevationNormalized, faceElevationNormalized);

      const waterMask = isWaterFace ? 1 : 0;
      faceWaterMask.push(waterMask, waterMask, waterMask);
    }
  }

  return {
    positions,
    faceElevation,
    faceWaterMask,
  };
}

function averageVertexHeight(faces: number[], faceHeights: number[]): number {
  if (faces.length === 0) {
    return 0;
  }

  let sum = 0;
  for (let i = 0; i < faces.length; i += 1) {
    sum += faceHeights[faces[i]];
  }

  return sum / faces.length;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function maxFinite(values: number[], fallback: number): number {
  let max = fallback;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (Number.isFinite(value) && value > max) {
      max = value;
    }
  }
  return Math.max(fallback, max);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, finiteOr(value, 0)));
}
