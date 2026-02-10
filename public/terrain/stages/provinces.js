import { createStepRng, STEP_SEEDS } from '../../client/engine/terrain';
import { basegenPolitical } from '../../client/engine/political';
import { toLegacyTerrainControls } from '../controls';
export function runProvincesStage(mesh, water, rivers, controls) {
    const seed = controls.seed >>> 0;
    const legacyControls = toLegacyTerrainControls(controls);
    return basegenPolitical(mesh.mesh, legacyControls, createStepRng(seed, STEP_SEEDS.province), water.isLand, rivers.riverEdgeMask);
}
