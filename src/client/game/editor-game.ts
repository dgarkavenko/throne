import type { TerrainGenerationControls } from '../../terrain/controls';
import type { TerrainSnapshot, WorldSnapshotMessage } from '../types';
import { SharedGameRuntime, type GameConfig } from './shared-game-runtime';

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
