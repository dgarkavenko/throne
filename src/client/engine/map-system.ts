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
import {
  DEFAULT_TERRAIN_RENDER_CONTROLS,
  hasRefinementControlChange,
  normalizeTerrainRenderControls,
  type TerrainRenderControls,
} from '../terrain/render-controls';
import { renderGeneratedTerrain } from '../terrain/renderer';
import {
  TerrainRefinementCacheStore,
  type TerrainRenderRefinementState,
} from '../terrain/refinement-cache';
import { toTerrainGenerationState } from '../../terrain/pipeline';

export class MapSystem {
  private generationControls: TerrainGenerationControls = { ...DEFAULT_TERRAIN_GENERATION_CONTROLS };
  private renderControls: TerrainRenderControls = { ...DEFAULT_TERRAIN_RENDER_CONTROLS };
  private generationCache: TerrainGenerationCache | null = null;
  private generationState: TerrainGenerationState | null = null;
  private readonly refinementCache = new TerrainRefinementCacheStore();
  private renderState: TerrainRenderRefinementState | null = null;
  private readonly config: TerrainGenerationConfig;

  constructor(config: TerrainGenerationConfig) {
    this.config = config;
  }

  getGenerationControls(): TerrainGenerationControls {
    return { ...this.generationControls };
  }

  getRenderControls(): TerrainRenderControls {
    return { ...this.renderControls };
  }

  getGenerationState(): TerrainGenerationState | null {
    return this.generationState;
  }

  getRenderState(): TerrainRenderRefinementState | null {
    return this.renderState;
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

  setTerrainRenderControls(next: TerrainRenderControls): {
    changed: boolean;
    refinementChanged: boolean;
  } {
    const sanitized = normalizeTerrainRenderControls(next);
    const prev = this.renderControls;
    const changed = JSON.stringify(prev) !== JSON.stringify(sanitized);
    const refinementChanged = hasRefinementControlChange(prev, sanitized);
    this.renderControls = sanitized;
    if (refinementChanged) {
      this.refinementCache.clear();
    }
    return { changed, refinementChanged };
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

  render(terrainLayer: any): TerrainRenderRefinementState | null {
    const generationState = this.ensureGenerationState();
    if (!terrainLayer) {
      return null;
    }
    this.renderState = renderGeneratedTerrain({
      config: this.config,
      terrainLayer,
      generationState,
      generationControls: this.generationControls,
      renderControls: this.renderControls,
      refinementCache: this.refinementCache,
    });
    return this.renderState;
  }
}

