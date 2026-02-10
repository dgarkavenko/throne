import { applyMountains, createStepRng, STEP_SEEDS } from '../../client/engine/terrain';
import { toLegacyTerrainControls } from '../controls';
export function runElevationStage(mesh, water, controls) {
    const seed = controls.seed >>> 0;
    const legacyControls = toLegacyTerrainControls(controls);
    return applyMountains(mesh.mesh, water, legacyControls, createStepRng(seed, STEP_SEEDS.mountain));
}
