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
    const presentation = this.terrain.getPresentationState();
    if (presentation) {
      this.r.renderTerrainStatic(presentation);
    }
  }

  setTerrainRenderControls(nextControls: TerrainRenderControls): void {
    const result = this.terrain.setTerrainRenderControls(nextControls);
    const presentation = this.terrain.getPresentationState();
    if (!presentation || !result.changed) {
      return;
    }
    if (result.refinementChanged) {
      this.r.renderTerrainStatic(presentation);
    } else {
      this.r.rerenderProvinceBorders(presentation);
    }
  }

  setMovementTestConfig(nextConfig: Partial<MovementTestConfig>): void {
    this.terrain.setNavigationConfig(nextConfig);
  }

  getTerrainVersion(): number {
    return this.terrain.state.lastTerrainVersion;
  }

  setTerrainGenerationControls(nextControls: TerrainGenerationControls): void {
    this.terrain.setTerrainGenerationControls(nextControls, true);
    const presentation = this.terrain.getPresentationState();
    if (presentation) {
      this.r.renderTerrainStatic(presentation);
    }
  }

  applyTerrainSnapshot(snapshot: TerrainSnapshot, terrainVersion: number): void {
    this.terrain.applyTerrainSnapshot(snapshot, terrainVersion);
    const presentation = this.terrain.getPresentationState();
    if (presentation) {
      this.r.renderTerrainStatic(presentation);
    }
  }

  getTerrainSnapshotForReplication(): TerrainSnapshot {
    return this.terrain.getTerrainSnapshotForReplication();
  }

  applyWorldSnapshot(_snapshot: WorldSnapshotMessage): void {
    // Editor runtime is terrain-only; world snapshots are ignored.
  }
}

