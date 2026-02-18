import { describe, expect, it } from 'vitest';
import { SharedTerrainRuntime } from '../src/client/runtime/shared-terrain-runtime';
import { DEFAULT_TERRAIN_GENERATION_CONTROLS } from '../src/terrain/controls';
import { buildProvincePickModel, pickProvinceAt } from '../src/client/runtime/province-pick';

const SIZE = { width: 512, height: 512 };

function buildRuntimePickModel(runtime: SharedTerrainRuntime) {
  const terrainState = runtime.state.terrainState;
  if (!terrainState) {
    return null;
  }
  return buildProvincePickModel(
    { width: runtime.mapWidth, height: runtime.mapHeight },
    terrainState,
    runtime.state.generationControls
  );
}

describe('runtime province pick', () => {
  it('returns null before terrain exists', () => {
    const runtime = new SharedTerrainRuntime(SIZE);
    const pickModel = buildRuntimePickModel(runtime);
    expect(pickModel).toBeNull();
  });

  it('returns null on water and province id on land', () => {
    const runtime = new SharedTerrainRuntime(SIZE);
    runtime.applyTerrainSnapshot(
      {
        controls: {
          ...DEFAULT_TERRAIN_GENERATION_CONTROLS,
          seed: 1337,
        },
        mapWidth: SIZE.width,
        mapHeight: SIZE.height,
      },
      1
    );
    const pickModel = buildRuntimePickModel(runtime);
    expect(pickModel).not.toBeNull();
    if (!pickModel) {
      return;
    }

    const terrainState = runtime.state.terrainState;
    expect(terrainState).not.toBeNull();
    if (!terrainState) {
      return;
    }

    let matchedLand = false;
    for (let i = 0; i < terrainState.water.isLand.length; i += 1) {
      if (!terrainState.water.isLand[i]) {
        continue;
      }
      const point = terrainState.mesh.mesh.faces[i]?.point;
      if (!point) {
        continue;
      }
      const expectedProvinceId = terrainState.provinces.provinceByFace[i];
      if (pickProvinceAt(pickModel, point.x, point.y) === expectedProvinceId) {
        matchedLand = true;
        break;
      }
    }
    expect(matchedLand).toBe(true);

    let matchedWater = false;
    for (let i = 0; i < terrainState.water.isLand.length; i += 1) {
      if (terrainState.water.isLand[i]) {
        continue;
      }
      const point = terrainState.mesh.mesh.faces[i]?.point;
      if (!point) {
        continue;
      }
      if (pickProvinceAt(pickModel, point.x, point.y) === null) {
        matchedWater = true;
        break;
      }
    }
    expect(matchedWater).toBe(true);
  });

  it('keeps pick results stable across renderer-side interactions', () => {
    const runtime = new SharedTerrainRuntime(SIZE);
    runtime.applyTerrainSnapshot(
      {
        controls: {
          ...DEFAULT_TERRAIN_GENERATION_CONTROLS,
          seed: 2024,
        },
        mapWidth: SIZE.width,
        mapHeight: SIZE.height,
      },
      1
    );

    const point = runtime.state.terrainState?.mesh.mesh.faces[0]?.point;
    expect(point).toBeDefined();
    if (!point) {
      return;
    }
    const pickModel = buildRuntimePickModel(runtime);
    expect(pickModel).not.toBeNull();
    if (!pickModel) {
      return;
    }
    const before = pickProvinceAt(pickModel, point.x, point.y);
    void runtime.getTerrainSnapshotForReplication();
    const after = pickProvinceAt(pickModel, point.x, point.y);
    expect(after).toBe(before);
  });
});
