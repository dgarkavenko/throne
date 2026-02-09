import { describe, it, expect } from 'vitest';
import { createRng } from '../src/client/engine/terrain';
import { basegenPolitical } from '../src/client/engine/political';
import type { RiverNetwork } from '../src/client/engine/rivers';

type MeshGraph = Parameters<typeof basegenPolitical>[0];

const createLineMesh = (elevations: number[]): MeshGraph => {
  const faces = elevations.map((elevation, index) => ({
    index,
    point: { x: index * 10, y: 0 },
    adjacentFaces: [] as number[],
    elevation,
  }));
  const edges = [];
  for (let i = 0; i < elevations.length - 1; i += 1) {
    faces[i].adjacentFaces.push(i + 1);
    faces[i + 1].adjacentFaces.push(i);
    edges.push({ faces: [i, i + 1] as [number, number] });
  }
  return { faces, edges };
};

describe('basegenPolitical terrain-aware barriers', () => {
  it('blocks growth across mountain passage threshold', () => {
    const mesh = createLineMesh([32, 32]);
    const controls = {
      provinceCount: 1,
      spacing: 32,
      provinceMountainPassageThreshold: 0.5,
      provinceSingleIslandMaxPercent: 0,
    };
    const result = basegenPolitical(mesh, controls, createRng(1));
    expect(result.faces.length).toBe(2);
    expect(result.provinceByFace[0]).not.toBe(result.provinceByFace[1]);
  });

  it('treats river barriers as hard passability splits', () => {
    const mesh = createLineMesh([10, 10, 10]);
    const riverNetwork: RiverNetwork = { traces: [], barrierEdgeSet: new Set([1]) };
    const controls = {
      provinceCount: 1,
      spacing: 32,
      provinceMountainPassageThreshold: 1,
      provinceSingleIslandMaxPercent: 0,
    };
    const result = basegenPolitical(mesh, controls, createRng(2), riverNetwork);
    const provinceA = result.provinceByFace[1];
    const provinceB = result.provinceByFace[2];
    expect(provinceA).not.toBe(provinceB);
    expect(result.faces[provinceA].adjacentProvinces).toContain(provinceB);
    expect(result.faces[provinceA].connectedProvinces).not.toContain(provinceB);
  });

  it('forces single province on small islands even with blocked internal edges', () => {
    const smallIsland = createLineMesh([32, 32]);
    const largeIsland = createLineMesh([10, 10, 10, 10, 10, 10]);
    const offset = smallIsland.faces.length;
    const mesh = {
      faces: [
        ...smallIsland.faces,
        ...largeIsland.faces.map((face) => ({
          ...face,
          index: face.index + offset,
          adjacentFaces: face.adjacentFaces.map((adj) => adj + offset),
          point: { x: face.point.x + 50, y: face.point.y },
        })),
      ],
      edges: [
        ...smallIsland.edges,
        ...largeIsland.edges.map((edge) => ({
          faces: [edge.faces[0] + offset, edge.faces[1] + offset] as [number, number],
        })),
      ],
    } satisfies MeshGraph;
    const controls = {
      provinceCount: 2,
      spacing: 32,
      provinceMountainPassageThreshold: 0,
      provinceSingleIslandMaxPercent: 25,
    };
    const result = basegenPolitical(mesh, controls, createRng(3));
    const smallProvince = result.provinceByFace[0];
    expect(result.provinceByFace[1]).toBe(smallProvince);
  });
});
