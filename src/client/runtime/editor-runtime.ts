/**
 * Browser runtime for `/editor` mode.
 * Terrain-only responsibilities:
 * - terrain generation apply/regenerate flow
 * - terrain rendering/debug controls
 * - local navigation graph rebuild from movement settings
 */
import { GameRenderer } from '../rendering/game-renderer';
import type { TerrainGenerationControls } from '../../terrain/controls';
import type { TerrainSnapshot, WorldSnapshotMessage } from '../../shared/protocol';
import type { TerrainRenderControls } from '../terrain/render-controls';
import {
  SharedTerrainRuntime,
  type TerrainNavigationConfig,
} from './shared-terrain-runtime';

export type GameConfig = {
  width: number;
  height: number;
};

type MovementTestConfig = TerrainNavigationConfig & {
  enabled: boolean;
  unitCount: number;
  spacingTarget: number;
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
      terrainLayer: this.r.terrainLayer,
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
  }

  setTerrainRenderControls(nextControls: TerrainRenderControls): void {
    this.terrain.setTerrainRenderControls(nextControls);
  }

  setMovementTestConfig(nextConfig: Partial<MovementTestConfig>): void {
    this.terrain.setNavigationConfig(nextConfig);
  }

  bind(_onFrame?: (deltaMs: number, now: number) => void): void {}

  getTerrainVersion(): number {
    return this.terrain.state.lastTerrainVersion;
  }

  setTerrainGenerationControls(nextControls: TerrainGenerationControls): void {
    this.terrain.setTerrainGenerationControls(nextControls, true);
  }

  applyTerrainSnapshot(snapshot: TerrainSnapshot, terrainVersion: number): void {
    this.terrain.applyTerrainSnapshot(snapshot, terrainVersion);
  }

  getTerrainSnapshotForReplication(): TerrainSnapshot {
    return this.terrain.getTerrainSnapshotForReplication();
  }

  applyWorldSnapshot(_snapshot: WorldSnapshotMessage): void {
    // Editor runtime is terrain-only; world snapshots are ignored.
  }
}

