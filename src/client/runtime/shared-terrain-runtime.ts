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
};

export class SharedTerrainRuntime {
  public readonly mapWidth: number;
  public readonly mapHeight: number;
  private readonly mapSystem: MapSystem;
  private hasAcceptedTerrainSnapshot = false;
  private lastTerrainVersion = 0;
  private terrainState: TerrainGenerationState | null = null;

  constructor(config: SharedTerrainRuntimeConfig) {
    this.mapWidth = config.width;
    this.mapHeight = config.height;
    this.mapSystem = new MapSystem({ width: config.width, height: config.height });
  }

  setTerrainGenerationControls(
    next: TerrainGenerationControls,
    regenerateIfMissing = false
  ): TerrainGenerationState | null {
    const result = this.mapSystem.setTerrainGenerationControls(next);
    if (!this.terrainState) {
      if (regenerateIfMissing) {
        return this.regenerateAll();
      }
      return null;
    }
    if (result.changed) {
      return this.regeneratePartial(result.dirty);
    }
    return this.terrainState;
  }

  applyTerrainSnapshot(snapshot: TerrainSnapshot, terrainVersion: number): TerrainGenerationState | null {
    if (this.hasAcceptedTerrainSnapshot) {
      console.warn('[SharedTerrainRuntime] ignoring terrain snapshot: terrain is immutable after first apply');
      return this.terrainState;
    }
    this.hasAcceptedTerrainSnapshot = true;
    this.lastTerrainVersion = Math.max(0, Math.round(terrainVersion));
    return this.setTerrainGenerationControls(snapshot.controls, true);
  }

  getGenerationControls(): TerrainGenerationControls {
    return this.mapSystem.getGenerationControls();
  }

  getTerrainVersion(): number {
    return this.lastTerrainVersion;
  }

  getTerrainSnapshotForReplication(): TerrainSnapshot {
    return {
      controls: this.mapSystem.getGenerationControls(),
      mapWidth: this.mapWidth,
      mapHeight: this.mapHeight,
    };
  }

  regenerateAll(): TerrainGenerationState {
    const state = this.mapSystem.regenerateAll();
    this.terrainState = state;
    return state;
  }

  regeneratePartial(dirty: TerrainGenerationDirtyFlags): TerrainGenerationState {
    const state = this.mapSystem.regeneratePartial(dirty);
    this.terrainState = state;
    return state;
  }
}
