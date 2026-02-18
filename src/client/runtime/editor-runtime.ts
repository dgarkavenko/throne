/**
 * Browser runtime for `/editor` mode.
 * Terrain-only responsibilities:
 * - terrain generation apply/regenerate flow
 * - terrain rendering/debug controls
 */
import { GameRenderer } from '../rendering/game-renderer';
import type { TerrainGenerationControls } from '../../terrain/controls';
import type { TerrainGenerationState } from '../../terrain/types';
import type { TerrainSnapshot, WorldSnapshotMessage } from '../../shared/protocol';
import type { TerrainRenderControls } from '../rendering/render-controls';
import { SharedTerrainRuntime } from './shared-terrain-runtime';

export type GameConfig = {
  width: number;
  height: number;
};

export class EditorGame {
  private readonly config: GameConfig;
  private readonly terrain: SharedTerrainRuntime;
  private terrainState: TerrainGenerationState | null = null;
  private readonly r: GameRenderer;

  constructor(config: GameConfig & { autoGenerateTerrain?: boolean }) {
    this.config = config;
    this.r = new GameRenderer();
    this.terrain = new SharedTerrainRuntime({
      width: config.width,
      height: config.height,
    });
    if (config.autoGenerateTerrain) {
      this.terrainState = this.terrain.regenerateAll();
    }
  }

  async init(field: HTMLElement | null): Promise<void> {
    await this.r.init(
      this.config.width,
      this.config.height,
      window.devicePixelRatio || 1,
      field
    );
    if (this.terrainState) {
      this.r.renderTerrain(
        this.terrain.mapWidth,
        this.terrain.mapHeight,
        this.terrainState,
        this.terrain.getGenerationControls()
      );
    }
  }

  setTerrainRenderControls(nextControls: TerrainRenderControls): void {
    const result = this.r.setTerrainRenderControls(nextControls);
    if (!this.terrainState || !result.changed) {
      return;
    }
    if (result.refinementChanged) {
      this.r.renderTerrain(
        this.terrain.mapWidth,
        this.terrain.mapHeight,
        this.terrainState,
        this.terrain.getGenerationControls()
      );
    } else {
      this.r.rerenderProvinceBorders();
    }
  }

  getTerrainVersion(): number {
    return this.terrain.getTerrainVersion();
  }

  setTerrainGenerationControls(nextControls: TerrainGenerationControls): void {
    this.terrainState = this.terrain.setTerrainGenerationControls(nextControls, true);
    if (this.terrainState) {
      this.r.renderTerrain(
        this.terrain.mapWidth,
        this.terrain.mapHeight,
        this.terrainState,
        this.terrain.getGenerationControls()
      );
    }
  }

  applyTerrainSnapshot(snapshot: TerrainSnapshot, terrainVersion: number): void {
    this.terrainState = this.terrain.applyTerrainSnapshot(snapshot, terrainVersion);
    if (this.terrainState) {
      this.r.renderTerrain(
        this.terrain.mapWidth,
        this.terrain.mapHeight,
        this.terrainState,
        this.terrain.getGenerationControls()
      );
    }
  }

  getTerrainSnapshotForReplication(): TerrainSnapshot {
    return this.terrain.getTerrainSnapshotForReplication();
  }

  applyWorldSnapshot(_snapshot: WorldSnapshotMessage): void {
    // Editor runtime is terrain-only; world snapshots are ignored.
  }
}

