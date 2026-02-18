import { MapSystem } from '../../terrain/runtime/map-system';
import type {
  TerrainGenerationDirtyFlags,
  TerrainGenerationState,
} from '../../terrain/types';
import type { TerrainGenerationControls } from '../../terrain/controls';
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
};

export class SharedTerrainRuntime {
  public readonly mapWidth: number;
  public readonly mapHeight: number;
  private readonly mapSystem: MapSystem;
  private hasAcceptedTerrainSnapshot = false;

  public readonly state: SharedTerrainRuntimeState;

  constructor(config: SharedTerrainRuntimeConfig) {
    this.mapWidth = config.width;
    this.mapHeight = config.height;
    this.mapSystem = new MapSystem({ width: config.width, height: config.height });
    this.state = {
      hasTerrain: false,
      lastTerrainVersion: 0,
      terrainState: null,
      generationControls: this.mapSystem.getGenerationControls(),
    };
    if (config.autoGenerateTerrain) {
      this.regenerateAll();
      this.hasAcceptedTerrainSnapshot = true;
    }
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
      mapWidth: this.mapWidth,
      mapHeight: this.mapHeight,
    };
  }

  regenerateAll(): void {
    const state = this.mapSystem.regenerateAll();
    this.state.generationControls = this.mapSystem.getGenerationControls();
    this.state.terrainState = state;
    this.state.hasTerrain = true;
  }

  regeneratePartial(dirty: TerrainGenerationDirtyFlags): void {
    const state = this.mapSystem.regeneratePartial(dirty);
    this.state.generationControls = this.mapSystem.getGenerationControls();
    this.state.terrainState = state;
    this.state.hasTerrain = true;
  }
}
