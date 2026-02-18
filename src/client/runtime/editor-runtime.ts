/**
 * Browser runtime for `/editor` mode.
 * Terrain-only responsibilities:
 * - terrain generation apply/regenerate flow
 * - terrain rendering/debug controls
 */
import { GameRenderer } from '../rendering/game-renderer';
import type { TerrainGenerationControls } from '../../terrain/controls';
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
  private readonly r: GameRenderer;

  constructor(config: GameConfig & { autoGenerateTerrain?: boolean }) {
    this.config = config;
    this.r = new GameRenderer();
    this.terrain = new SharedTerrainRuntime({
      width: config.width,
      height: config.height,
      autoGenerateTerrain: config.autoGenerateTerrain,
    });
  }

  async init(field: HTMLElement | null): Promise<void> {
    await this.r.init(
      this.config.width,
      this.config.height,
      window.devicePixelRatio || 1,
      field
    );
    const terrainState = this.terrain.state.terrainState;
    if (terrainState) {
      this.r.renderTerrain(
        this.terrain.mapWidth,
        this.terrain.mapHeight,
        terrainState,
        this.terrain.state.generationControls
      );
    }
  }

  setTerrainRenderControls(nextControls: TerrainRenderControls): void {
    const result = this.r.setTerrainRenderControls(nextControls);
    const terrainState = this.terrain.state.terrainState;
    if (!terrainState || !result.changed) {
      return;
    }
    if (result.refinementChanged) {
      this.r.renderTerrain(
        this.terrain.mapWidth,
        this.terrain.mapHeight,
        terrainState,
        this.terrain.state.generationControls
      );
    } else {
      this.r.rerenderProvinceBorders();
    }
  }

  getTerrainVersion(): number {
    return this.terrain.state.lastTerrainVersion;
  }

  setTerrainGenerationControls(nextControls: TerrainGenerationControls): void {
    this.terrain.setTerrainGenerationControls(nextControls, true);
    const terrainState = this.terrain.state.terrainState;
    if (terrainState) {
      this.r.renderTerrain(
        this.terrain.mapWidth,
        this.terrain.mapHeight,
        terrainState,
        this.terrain.state.generationControls
      );
    }
  }

  applyTerrainSnapshot(snapshot: TerrainSnapshot, terrainVersion: number): void {
    this.terrain.applyTerrainSnapshot(snapshot, terrainVersion);
    const terrainState = this.terrain.state.terrainState;
    if (terrainState) {
      this.r.renderTerrain(
        this.terrain.mapWidth,
        this.terrain.mapHeight,
        terrainState,
        this.terrain.state.generationControls
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

