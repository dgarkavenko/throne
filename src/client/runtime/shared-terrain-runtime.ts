import type { Container } from 'pixi.js';
import { MapSystem } from '../../terrain/runtime/map-system';
import type {
  TerrainGenerationDirtyFlags,
  TerrainGenerationState,
} from '../../terrain/types';
import type { TerrainGenerationControls } from '../../terrain/controls';
import {
  buildNavigationGraph,
  type NavigationGraph,
} from '../../terrain/navigation/pathfinding';
import {
  DEFAULT_TERRAIN_RENDER_CONTROLS,
  type TerrainRenderControls,
} from '../terrain/render-controls';
import { TerrainRenderer } from '../terrain/renderer';
import type { TerrainSnapshot } from '../../shared/protocol';

export type TerrainNavigationConfig = {
  timePerFaceSeconds: number;
  lowlandThreshold: number;
  impassableThreshold: number;
  elevationPower: number;
  elevationGainK: number;
  riverPenalty: number;
};

export type SharedTerrainRuntimeConfig = {
  width: number;
  height: number;
  terrainLayer: Container;
  autoGenerateTerrain?: boolean;
};

export type SharedTerrainRuntimeState = {
  hasTerrain: boolean;
  lastTerrainVersion: number;
  terrainState: TerrainGenerationState | null;
  navigationGraph: NavigationGraph | null;
  generationControls: TerrainGenerationControls;
  renderControls: TerrainRenderControls;
  navigationConfig: TerrainNavigationConfig;
};

const DEFAULT_NAVIGATION_CONFIG: TerrainNavigationConfig = {
  timePerFaceSeconds: 180,
  lowlandThreshold: 10,
  impassableThreshold: 28,
  elevationPower: 0.8,
  elevationGainK: 1,
  riverPenalty: 0.8,
};

export class SharedTerrainRuntime {
  private readonly config: SharedTerrainRuntimeConfig;
  private readonly mapSystem: MapSystem;
  private readonly terrainRenderer: TerrainRenderer;

  public readonly state: SharedTerrainRuntimeState;

  constructor(config: SharedTerrainRuntimeConfig) {
    this.config = config;
    this.mapSystem = new MapSystem({ width: config.width, height: config.height });
    this.terrainRenderer = new TerrainRenderer({
      config: { width: config.width, height: config.height },
      terrainLayer: config.terrainLayer,
    });
    this.state = {
      hasTerrain: false,
      lastTerrainVersion: 0,
      terrainState: null,
      navigationGraph: null,
      generationControls: this.mapSystem.getGenerationControls(),
      renderControls: { ...DEFAULT_TERRAIN_RENDER_CONTROLS },
      navigationConfig: { ...DEFAULT_NAVIGATION_CONFIG },
    };
    if (config.autoGenerateTerrain) {
      this.regenerateAll();
    }
  }

  getOverlayContainer(): any | null {
    return this.terrainRenderer.getOverlayContainer();
  }

  setTerrainGenerationControls(
    next: TerrainGenerationControls,
    regenerateIfMissing = false
  ): void {
    const result = this.mapSystem.setTerrainGenerationControls(next);
    this.state.generationControls = this.mapSystem.getGenerationControls();
    if (!this.state.hasTerrain) {
      if (regenerateIfMissing) {
        this.regenerateAll();
      }
      return;
    }
    if (result.changed) {
      this.regeneratePartial(result.dirty);
      return;
    }
    if (this.state.terrainState) {
      this.renderTerrainState(this.state.terrainState);
    }
  }

  applyTerrainSnapshot(snapshot: TerrainSnapshot, terrainVersion: number): void {
    this.state.lastTerrainVersion = Math.max(0, Math.round(terrainVersion));
    this.setTerrainGenerationControls(snapshot.controls, true);
  }

  getTerrainSnapshotForReplication(): TerrainSnapshot {
    return {
      controls: this.mapSystem.getGenerationControls(),
      mapWidth: this.config.width,
      mapHeight: this.config.height,
    };
  }

  setTerrainRenderControls(next: TerrainRenderControls): void {
    const result = this.terrainRenderer.setRenderControls(next);
    this.state.renderControls = this.terrainRenderer.getRenderControls();
    if (!this.state.hasTerrain || !this.state.terrainState || !result.changed) {
      return;
    }
    if (result.refinementChanged) {
      this.renderTerrainState(this.state.terrainState);
      return;
    }
    this.terrainRenderer.rerenderProvinceBorders(this.mapSystem.getGenerationControls());
  }

  setNavigationConfig(next: Partial<TerrainNavigationConfig>): void {
    const prev = this.state.navigationConfig;
    const merged = {
      ...prev,
      ...next,
    };
    const hasCostChange =
      prev.lowlandThreshold !== merged.lowlandThreshold ||
      prev.impassableThreshold !== merged.impassableThreshold ||
      prev.elevationPower !== merged.elevationPower ||
      prev.elevationGainK !== merged.elevationGainK ||
      prev.riverPenalty !== merged.riverPenalty;
    this.state.navigationConfig = merged;
    if (hasCostChange) {
      this.rebuildNavigationGraph();
    }
  }

  regenerateAll(): void {
    const state = this.mapSystem.regenerateAll();
    this.state.generationControls = this.mapSystem.getGenerationControls();
    this.state.terrainState = state;
    this.rebuildNavigationGraph();
    this.renderTerrainState(state);
    this.state.hasTerrain = true;
  }

  regeneratePartial(dirty: TerrainGenerationDirtyFlags): void {
    const state = this.mapSystem.regeneratePartial(dirty);
    this.state.generationControls = this.mapSystem.getGenerationControls();
    this.state.terrainState = state;
    this.rebuildNavigationGraph();
    this.renderTerrainState(state);
    this.state.hasTerrain = true;
  }

  private renderTerrainState(state: TerrainGenerationState): void {
    this.terrainRenderer.render(state, this.mapSystem.getGenerationControls());
  }

  private rebuildNavigationGraph(): void {
    if (!this.state.terrainState) {
      this.state.navigationGraph = null;
      return;
    }
    const terrainMesh = this.state.terrainState.mesh.mesh;
    const navMesh = {
      faces: terrainMesh.faces.map((face) => ({
        index: face.index,
        point: { x: face.point.x, y: face.point.y },
        adjacentFaces: [...face.adjacentFaces],
        elevation: face.elevation,
      })),
      edges: terrainMesh.edges.map((edge) => ({ faces: edge.faces })),
    };
    this.state.navigationGraph = buildNavigationGraph(
      navMesh,
      this.state.terrainState.water.isLand,
      this.state.terrainState.rivers.riverEdgeMask,
      {
        lowlandThreshold: this.state.navigationConfig.lowlandThreshold,
        impassableThreshold: this.state.navigationConfig.impassableThreshold,
        elevationPower: this.state.navigationConfig.elevationPower,
        elevationGainK: this.state.navigationConfig.elevationGainK,
        riverPenalty: this.state.navigationConfig.riverPenalty,
      }
    );
  }
}

