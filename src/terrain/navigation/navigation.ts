import { Vec2, vec2Add } from "../core/math";
import { MeshGraph } from "../core/terrain-core";

export type NavFace = {
	index: number;
	centroid: Vec2;
	neighbors: NavNeighbor[];
};

export type NavData = {
	faces: NavFace[];
};

export type NavNeighbor = {
	face: number;   // neighboring face index
	edge: number;   // shared edge index (portal)
};

function buildNavData(mesh: MeshGraph): NavFace[]
{
	const navFaces: NavFace[] = new Array(mesh.faces.length);

	for (const face of mesh.faces)
	{
		const seen = new Set<number>();

		navFaces[face.index] = {
			index: face.index,
			centroid: face.point,
			neighbors,
		};
	}

	return navFaces;
}
