import { Container, Graphics } from 'pixi.js';
import { renderTerrain, updateProvinceBorders } from '../../terrain/core/terrain-core';
import { toLegacyTerrainControls, type TerrainGenerationControls } from '../../terrain/controls';
import type { TerrainGenerationState } from '../../terrain/types';
import {
  DEFAULT_TERRAIN_RENDER_CONTROLS,
  hasRefinementControlChange,
  normalizeTerrainRenderControls,
  type TerrainRenderControls,
} from './render-controls';
import {
  TerrainRefinementCacheStore,
  type TerrainRenderRefinementState,
} from './refinement-cache';

type TerrainRenderConfig = {
  width: number;
  height: number;
};

type MeshOverlay = {
  container: any;
  polygonGraph: any;
  dualGraph: any;
  cornerNodes: any;
  centerNodes: any;
  insertedNodes: any;
};

export class TerrainRenderer {
  private readonly config: TerrainRenderConfig;
  private readonly terrainLayer: any;
  private renderControls: TerrainRenderControls = { ...DEFAULT_TERRAIN_RENDER_CONTROLS };
  private readonly refinementCache = new TerrainRefinementCacheStore();
  private meshOverlay: MeshOverlay | null = null;

  constructor(args: { config: TerrainRenderConfig; terrainLayer: any }) {
    this.config = args.config;
    this.terrainLayer = args.terrainLayer;
  }

  setRenderControls(nextControls: TerrainRenderControls): {
    changed: boolean;
    refinementChanged: boolean;
  } {
    const sanitized = normalizeTerrainRenderControls(nextControls);
    const prev = this.renderControls;
    const changed = JSON.stringify(prev) !== JSON.stringify(sanitized);
    const refinementChanged = hasRefinementControlChange(prev, sanitized);
    this.renderControls = sanitized;
    if (refinementChanged) {
      this.refinementCache.clear();
    }
    return { changed, refinementChanged };
  }

  getRenderControls(): TerrainRenderControls {
    return { ...this.renderControls };
  }

  render(
    generationState: TerrainGenerationState,
    generationControls: TerrainGenerationControls
  ): TerrainRenderRefinementState | null {
    if (!this.terrainLayer) {
      return null;
    }
    const legacyControls = toLegacyTerrainControls(generationControls, {
      showPolygonGraph: this.renderControls.showPolygonGraph,
      showDualGraph: this.renderControls.showDualGraph,
      showCornerNodes: this.renderControls.showCornerNodes,
      showCenterNodes: this.renderControls.showCenterNodes,
      showInsertedPoints: this.renderControls.showInsertedPoints,
      provinceBorderWidth: this.renderControls.provinceBorderWidth,
      showLandBorders: this.renderControls.showLandBorders,
      showShoreBorders: this.renderControls.showShoreBorders,
      intermediateSeed: this.renderControls.intermediateSeed,
      intermediateMaxIterations: this.renderControls.intermediateMaxIterations,
      intermediateThreshold: this.renderControls.intermediateThreshold,
      intermediateRelMagnitude: this.renderControls.intermediateRelMagnitude,
      intermediateAbsMagnitude: this.renderControls.intermediateAbsMagnitude,
    });
    const refined = this.refinementCache.resolve(generationState, generationControls, this.renderControls);
    const base = {
      mesh: generationState.mesh.mesh,
      baseCells: generationState.mesh.baseCells,
      isLand: generationState.water.isLand,
      oceanWater: generationState.water.oceanWater,
    };
    const refinedPayload = { refinedGeometry: refined.refinedGeometry, rivers: refined.rivers };
    renderTerrain(this.config, legacyControls, this.terrainLayer, base, generationState.provinces, refinedPayload);
    const overlay = this.ensureMeshOverlay();
    this.renderMeshOverlay(generationState.mesh.mesh, refined.refinedGeometry.insertedPoints, overlay);
    this.setGraphOverlayVisibility();
    return refined;
  }

  rerenderProvinceBorders(generationControls: TerrainGenerationControls): void {
    if (!this.terrainLayer) {
      return;
    }
    const legacyControls = toLegacyTerrainControls(generationControls, {
      showPolygonGraph: this.renderControls.showPolygonGraph,
      showDualGraph: this.renderControls.showDualGraph,
      showCornerNodes: this.renderControls.showCornerNodes,
      showCenterNodes: this.renderControls.showCenterNodes,
      showInsertedPoints: this.renderControls.showInsertedPoints,
      provinceBorderWidth: this.renderControls.provinceBorderWidth,
      showLandBorders: this.renderControls.showLandBorders,
      showShoreBorders: this.renderControls.showShoreBorders,
      intermediateSeed: this.renderControls.intermediateSeed,
      intermediateMaxIterations: this.renderControls.intermediateMaxIterations,
      intermediateThreshold: this.renderControls.intermediateThreshold,
      intermediateRelMagnitude: this.renderControls.intermediateRelMagnitude,
      intermediateAbsMagnitude: this.renderControls.intermediateAbsMagnitude,
    });
    updateProvinceBorders(this.terrainLayer, legacyControls);
    this.setGraphOverlayVisibility();
  }

  getOverlayContainer(): any | null {
    return this.meshOverlay?.container ?? null;
  }

  private ensureMeshOverlay(): MeshOverlay {
    if (this.meshOverlay) {
      this.terrainLayer.setChildIndex(this.meshOverlay.container, this.terrainLayer.children.length - 1);
      return this.meshOverlay;
    }
    const container = new Container();
    const polygonGraph = new Graphics();
    const dualGraph = new Graphics();
    const cornerNodes = new Graphics();
    const centerNodes = new Graphics();
    const insertedNodes = new Graphics();
    container.addChild(polygonGraph);
    container.addChild(dualGraph);
    container.addChild(cornerNodes);
    container.addChild(centerNodes);
    container.addChild(insertedNodes);
    this.terrainLayer.addChild(container);
    this.meshOverlay = { container, polygonGraph, dualGraph, cornerNodes, centerNodes, insertedNodes };
    return this.meshOverlay;
  }

  private setGraphOverlayVisibility(): void {
    if (!this.meshOverlay) {
      return;
    }
    this.meshOverlay.polygonGraph.visible = this.renderControls.showPolygonGraph;
    this.meshOverlay.dualGraph.visible = this.renderControls.showDualGraph;
    this.meshOverlay.cornerNodes.visible = this.renderControls.showCornerNodes;
    this.meshOverlay.centerNodes.visible = this.renderControls.showCenterNodes;
    this.meshOverlay.insertedNodes.visible = this.renderControls.showInsertedPoints;
    this.meshOverlay.container.visible =
      this.renderControls.showPolygonGraph ||
      this.renderControls.showDualGraph ||
      this.renderControls.showCornerNodes ||
      this.renderControls.showCenterNodes ||
      this.renderControls.showInsertedPoints;
  }

  private renderMeshOverlay(
    mesh: any,
    insertedPoints: Array<{ x: number; y: number }>,
    overlay: MeshOverlay
  ): void {
    overlay.polygonGraph.clear();
    overlay.dualGraph.clear();
    overlay.cornerNodes.clear();
    overlay.centerNodes.clear();
    overlay.insertedNodes.clear();

    const polygonGraph = overlay.polygonGraph;
    mesh.edges.forEach((edge: any) => {
      const vertexA = mesh.vertices[edge.vertices[0]].point;
      const vertexB = mesh.vertices[edge.vertices[1]].point;
      polygonGraph.moveTo(vertexA.x, vertexA.y);
      polygonGraph.lineTo(vertexB.x, vertexB.y);
    });
    polygonGraph.stroke({ width: 1.3, color: 0xff4d4f, alpha: 0.75 });

    const dualGraph = overlay.dualGraph;
    mesh.edges.forEach((edge: any) => {
      const [faceA, faceB] = edge.faces;
      if (faceA < 0 || faceB < 0) {
        return;
      }
      const a = mesh.faces[faceA].point;
      const b = mesh.faces[faceB].point;
      dualGraph.moveTo(a.x, a.y);
      dualGraph.lineTo(b.x, b.y);
    });
    dualGraph.stroke({ width: 0.9, color: 0x4da3ff, alpha: 0.8 });

    const cornerNodes = overlay.cornerNodes;
    mesh.vertices.forEach((vertex: any) => {
      cornerNodes.circle(vertex.point.x, vertex.point.y, 1.8);
    });
    cornerNodes.fill({ color: 0xf3fff7, alpha: 0.9 });

    const centerNodes = overlay.centerNodes;
    mesh.faces.forEach((face: any) => {
      centerNodes.circle(face.point.x, face.point.y, 2.3);
    });
    centerNodes.fill({ color: 0xff00c9, alpha: 0.95 });

    const overlayInsertedNodes = overlay.insertedNodes;
    for (let i = 0; i < insertedPoints.length; i += 1) {
      const point = insertedPoints[i];
      overlayInsertedNodes.circle(point.x, point.y, 2.2);
    }
    overlayInsertedNodes.fill({ color: 0xffe56b, alpha: 0.9 });
  }
}
