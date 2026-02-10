import { createStepRng, generateWater, STEP_SEEDS } from '../../client/engine/terrain';
import { toLegacyTerrainControls } from '../controls';
export function runWaterStage(config, mesh, controls) {
    const seed = controls.seed >>> 0;
    const legacyControls = toLegacyTerrainControls(controls);
    return generateWater(config, mesh.mesh, mesh.baseCells, legacyControls, createStepRng(seed, STEP_SEEDS.water));
}
