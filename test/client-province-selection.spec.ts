import { describe, expect, it } from 'vitest';
import { resolveHoverTarget, resolveSelectionTarget } from '../src/client/runtime/selection-policy';
import { DEFAULT_TERRAIN_GENERATION_CONTROLS } from '../src/terrain/controls';
import { buildTerrainGeneration, toTerrainGenerationState } from '../src/terrain/pipeline';
import { buildProvincePickModel, pickProvinceAt } from '../src/client/terrain/presentation';

describe('client province selection policy', () => {
  it('prioritizes actor over province for hover and selection', () => {
    expect(resolveHoverTarget(12, 3)).toEqual({ actorId: 12, provinceId: null });
    expect(resolveSelectionTarget(9, 2)).toEqual({ actorId: 9, provinceId: null });
  });

  it('selects province when no actor is hit', () => {
    expect(resolveHoverTarget(null, 4)).toEqual({ actorId: null, provinceId: 4 });
    expect(resolveSelectionTarget(null, 5)).toEqual({ actorId: null, provinceId: 5 });
  });

  it('returns null province when clicking water', () => {
    const controls = {
      ...DEFAULT_TERRAIN_GENERATION_CONTROLS,
      seed: 1337,
    };
    const state = toTerrainGenerationState(
      buildTerrainGeneration({
        config: { width: 512, height: 512 },
        controls,
      })
    );
    const pickModel = buildProvincePickModel({ width: 512, height: 512 }, state, controls);

    expect(pickProvinceAt(pickModel, 0, 0)).toBeNull();
  });
});
