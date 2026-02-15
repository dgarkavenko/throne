import type { TerrainRenderControls } from '../terrain/render-controls';
import type { TerrainSnapshot, WorldSnapshotMessage } from '../types';
import { SharedGameRuntime, type GameConfig } from './shared-game-runtime';

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
