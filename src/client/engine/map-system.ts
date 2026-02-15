import { buildTerrainGeneration, computeGenerationDirty } from '../../terrain/pipeline';
import type {
  TerrainGenerationCache,
  TerrainGenerationConfig,
  TerrainGenerationDirtyFlags,
  TerrainGenerationState,
} from '../../terrain/types';
import {
  DEFAULT_TERRAIN_GENERATION_CONTROLS,
  normalizeTerrainGenerationControls,
  type TerrainGenerationControls,
} from '../../terrain/controls';
import { toTerrainGenerationState } from '../../terrain/pipeline';

export class MapSystem {
  private generationControls: TerrainGenerationControls = { ...DEFAULT_TERRAIN_GENERATION_CONTROLS };
  private generationCache: TerrainGenerationCache | null = null;
  private generationState: TerrainGenerationState | null = null;
  private readonly config: TerrainGenerationConfig;

  constructor(config: TerrainGenerationConfig) {
    this.config = config;
  }

  getGenerationControls(): TerrainGenerationControls {
    return { ...this.generationControls };
  }

  getGenerationState(): TerrainGenerationState | null {
    return this.generationState;
  }

  setTerrainGenerationControls(next: TerrainGenerationControls): {
    changed: boolean;
    dirty: TerrainGenerationDirtyFlags;
  } {
    const sanitized = normalizeTerrainGenerationControls(next);
    const dirty = computeGenerationDirty(this.generationControls, sanitized);
    const changed = dirty.mesh || dirty.water || dirty.elevation || dirty.rivers || dirty.provinces;
    this.generationControls = sanitized;
    return { changed, dirty };
  }

  regenerateAll(): TerrainGenerationState {
    this.generationCache = buildTerrainGeneration({
      config: this.config,
      controls: this.generationControls,
      previous: null,
    });
    this.generationState = toTerrainGenerationState(this.generationCache);
    return this.generationState;
  }

  regeneratePartial(dirty: TerrainGenerationDirtyFlags): TerrainGenerationState {
    this.generationCache = buildTerrainGeneration({
      config: this.config,
      controls: this.generationControls,
      previous: this.generationCache,
      dirty,
    });
    this.generationState = toTerrainGenerationState(this.generationCache);
    return this.generationState;
  }

  ensureGenerationState(): TerrainGenerationState {
    if (this.generationState) {
      return this.generationState;
    }
    return this.regenerateAll();
  }
}
