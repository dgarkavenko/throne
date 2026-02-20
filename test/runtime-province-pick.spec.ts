import { describe, expect, it } from 'vitest';
import { addComponent, addEntity, createWorld, type World } from 'bitecs';
import { SharedTerrainRuntime } from '../src/client/runtime/shared-terrain-runtime';
import { DEFAULT_TERRAIN_GENERATION_CONTROLS } from '../src/terrain/controls';
import { buildProvincePickModel, pickProvinceAt } from '../src/client/runtime/province-pick';
import { ProvinceComponent } from '../src/ecs/components';
import type { TerrainGenerationState } from '../src/terrain/types';

const SIZE = { width: 512, height: 512 };

function createProvinceWorld(terrainState: TerrainGenerationState): World {
  const world = createWorld();
  const provinceCount = terrainState.provinces.faces.length;
  for (let provinceId = 0; provinceId < provinceCount; provinceId += 1) {
    const entity = addEntity(world);
    addComponent(world, entity, ProvinceComponent);
    ProvinceComponent.provinceId[entity] = provinceId;
    ProvinceComponent.face[entity] = terrainState.provinces.faces[provinceId];
  }
  return world;
}

function buildRuntimePickModel(runtime: SharedTerrainRuntime, terrainState: TerrainGenerationState | null) {
  if (!terrainState) {
    return null;
  }
  const world = createProvinceWorld(terrainState);
  return buildProvincePickModel(
    { width: runtime.mapWidth, height: runtime.mapHeight },
    terrainState,
    world
  );
}

describe('runtime province pick', () => {
  it('returns null before terrain exists', () => {
    const runtime = new SharedTerrainRuntime(SIZE);
    const pickModel = buildRuntimePickModel(runtime, null);
    expect(pickModel).toBeNull();
  });

  it('returns null on water and province id on land', () => {
    const runtime = new SharedTerrainRuntime(SIZE);
    const terrainState = runtime.applyTerrainSnapshot(
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
    const pickModel = buildRuntimePickModel(runtime, terrainState);
    expect(pickModel).not.toBeNull();
    if (!pickModel) {
      return;
    }

    expect(terrainState).not.toBeNull();
    if (!terrainState) {
      return;
    }

    let matchedLand = false;
    for (let i = 0; i < terrainState.water.isLand.length; i += 1) {
      if (!terrainState.water.isLand[i]) {
        continue;
      }
      const point = terrainState.mesh.faces[i]?.point;
      if (!point) {
        continue;
      }
      const expectedProvinceId = terrainState.provinces.provinceByFace[i];
      const pickedProvinceEntity = pickProvinceAt(pickModel, point.x, point.y);
      if (
        pickedProvinceEntity !== null &&
        ProvinceComponent.provinceId[pickedProvinceEntity] === expectedProvinceId
      ) {
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
      const point = terrainState.mesh.faces[i]?.point;
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
    const terrainState = runtime.applyTerrainSnapshot(
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

    const point = terrainState?.mesh.faces[0]?.point;
    expect(point).toBeDefined();
    if (!point) {
      return;
    }
    const pickModel = buildRuntimePickModel(runtime, terrainState);
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
