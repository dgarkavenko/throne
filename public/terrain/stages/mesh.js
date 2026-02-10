import { createStepRng, generateMesh, STEP_SEEDS } from '../../client/engine/terrain';
import { toLegacyTerrainControls } from '../controls';
export function runMeshStage(config, controls) {
    const seed = controls.seed >>> 0;
    const legacyControls = toLegacyTerrainControls(controls);
    return generateMesh(config, legacyControls, createStepRng(seed, STEP_SEEDS.mesh));
}
