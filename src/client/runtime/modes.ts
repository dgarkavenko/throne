import type { TerrainGenerationControls } from '../../terrain/controls';
import type { TerrainRenderControls } from '../terrain/render-controls';
import type { TerrainSnapshot, WorldSnapshotMessage } from '../../shared/protocol';
import { SharedGameRuntime, type GameConfig } from './shared-runtime';

export class ClientGame extends SharedGameRuntime {
  constructor(config: GameConfig) {
    super(config);
  }

  setTerrainRenderControls(nextControls: TerrainRenderControls): void {
    super.setTerrainRenderControls(nextControls);
  }

  applyTerrainSnapshot(snapshot: TerrainSnapshot, terrainVersion: number): void {
    this.applyTerrainSnapshotInternal(snapshot, terrainVersion);
  }

  applyWorldSnapshot(snapshot: WorldSnapshotMessage): void {
    this.applyWorldSnapshotInternal(snapshot, true);
  }
}

export class EditorGame extends SharedGameRuntime {
  private readonly autoGenerateTerrain: boolean;

  constructor(config: GameConfig & { autoGenerateTerrain?: boolean }) {
    super(config);
    this.autoGenerateTerrain = config.autoGenerateTerrain !== false;
  }

  override async init(field: HTMLElement | null): Promise<void> {
    await super.init(field);
    if (this.autoGenerateTerrain) {
      this.regenerateTerrain();
    }
  }

  setTerrainGenerationControls(nextControls: TerrainGenerationControls): void {
    this.setTerrainGenerationControlsInternal(nextControls, this.autoGenerateTerrain);
  }

  getTerrainSnapshotForReplication(): TerrainSnapshot {
    return this.getTerrainSnapshotForReplicationInternal();
  }

  applyTerrainSnapshot(snapshot: TerrainSnapshot, terrainVersion: number): void {
    this.applyTerrainSnapshotInternal(snapshot, terrainVersion);
  }

  applyWorldSnapshot(snapshot: WorldSnapshotMessage): void {
    this.applyWorldSnapshotInternal(snapshot, false);
  }
}
