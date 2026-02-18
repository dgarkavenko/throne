import { MapSystem } from '../../terrain/runtime/map-system';
import type {
  TerrainGenerationDirtyFlags,
  TerrainGenerationState,
} from '../../terrain/types';
import type { TerrainGenerationControls } from '../../terrain/controls';
import {
  DEFAULT_TERRAIN_RENDER_CONTROLS,
  hasRefinementControlChange,
  normalizeTerrainRenderControls,
  type TerrainRenderControls,
} from '../terrain/render-controls';
import { TerrainRefinementCacheStore } from '../terrain/refinement-cache';
import {
  buildTerrainPresentationState,
  pickProvinceAt as pickProvinceFromModel,
} from '../terrain/presentation';
import type { TerrainPresentationState } from '../terrain/types';
import type { TerrainSnapshot } from '../../shared/protocol';

export type SharedTerrainRuntimeConfig = {
  width: number;
  height: number;
  autoGenerateTerrain?: boolean;
};

export type SharedTerrainRuntimeState = {
  hasTerrain: boolean;
  lastTerrainVersion: number;
  terrainState: TerrainGenerationState | null;
  generationControls: TerrainGenerationControls;
  renderControls: TerrainRenderControls;
};

export class SharedTerrainRuntime {
  private readonly config: SharedTerrainRuntimeConfig;
  private readonly mapSystem: MapSystem;
  private readonly refinementCache = new TerrainRefinementCacheStore();
  private presentationState: TerrainPresentationState | null = null;
  private hasAcceptedTerrainSnapshot = false;

  public readonly state: SharedTerrainRuntimeState;

  constructor(config: SharedTerrainRuntimeConfig) {
    this.config = config;
    this.mapSystem = new MapSystem({ width: config.width, height: config.height });
    this.state = {
      hasTerrain: false,
      lastTerrainVersion: 0,
      terrainState: null,
      generationControls: this.mapSystem.getGenerationControls(),
      renderControls: { ...DEFAULT_TERRAIN_RENDER_CONTROLS },
    };
    if (config.autoGenerateTerrain) {
      this.regenerateAll();
      this.hasAcceptedTerrainSnapshot = true;
    }
  }

  getPresentationState(): TerrainPresentationState | null {
    return this.presentationState;
  }

  pickProvinceAt(worldX: number, worldY: number): number | null {
    if (!this.presentationState) {
      return null;
    }
    return pickProvinceFromModel(this.presentationState.pick, worldX, worldY);
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
    this.rebuildPresentationState();
  }

  applyTerrainSnapshot(snapshot: TerrainSnapshot, terrainVersion: number): void {
    if (this.hasAcceptedTerrainSnapshot) {
      console.warn('[SharedTerrainRuntime] ignoring terrain snapshot: terrain is immutable after first apply');
      return;
    }
    this.hasAcceptedTerrainSnapshot = true;
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

  setTerrainRenderControls(next: TerrainRenderControls): {
    changed: boolean;
    refinementChanged: boolean;
  } {
    const sanitized = normalizeTerrainRenderControls(next);
    const prev = this.state.renderControls;
    const changed = JSON.stringify(prev) !== JSON.stringify(sanitized);
    const refinementChanged = hasRefinementControlChange(prev, sanitized);
    this.state.renderControls = sanitized;
    if (refinementChanged) {
      this.refinementCache.clear();
    }
    if (this.state.hasTerrain && changed) {
      this.rebuildPresentationState();
    }
    return { changed, refinementChanged };
  }

  regenerateAll(): void {
    const state = this.mapSystem.regenerateAll();
    this.state.generationControls = this.mapSystem.getGenerationControls();
    this.state.terrainState = state;
    this.rebuildPresentationState();
    this.state.hasTerrain = true;
  }

  regeneratePartial(dirty: TerrainGenerationDirtyFlags): void {
    const state = this.mapSystem.regeneratePartial(dirty);
    this.state.generationControls = this.mapSystem.getGenerationControls();
    this.state.terrainState = state;
    this.rebuildPresentationState();
    this.state.hasTerrain = true;
  }

  private rebuildPresentationState(): void {
    if (!this.state.terrainState) {
      this.presentationState = null;
      return;
    }
    const refined = this.refinementCache.resolve(
      this.state.terrainState,
      this.state.generationControls,
      this.state.renderControls
    );
    this.presentationState = buildTerrainPresentationState(
      { width: this.config.width, height: this.config.height },
      this.state.terrainState,
      this.state.generationControls,
      this.state.renderControls,
      refined
    );
  }

}
