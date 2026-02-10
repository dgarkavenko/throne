import { buildRiverTraces, createStepRng, STEP_SEEDS } from '../../client/engine/terrain';
import { toLegacyTerrainControls } from '../controls';
export function runRiversStage(mesh, water, controls) {
    const seed = controls.seed >>> 0;
    const legacyControls = toLegacyTerrainControls(controls);
    return buildRiverTraces(mesh.mesh, legacyControls, createStepRng(seed, STEP_SEEDS.river), water.isLand, water.oceanWater);
}
