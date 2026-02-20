import { Vec2 } from "../terrain/core/math";
import { ProvinceFace } from "../terrain/core/political-core";

export const ActorComponent = {
	netId: [] as number[],
	ownerId: [] as number[]
}

export const TerrainLocationComponent = {
	faceId: [] as number[]
};

export const TerrainRouteComponent =
{
	lastStateSeq: [] as number[],
	routeStartFace: [] as number[],
	routeTargetFace: [] as number[],
	routeStartedAtServerMs: [] as number[],
};

export const RenderableComponent = {
	color: [] as number[],
	content: [] as string[],
	anchor: [] as number[],
	x: [] as number[],
	y: [] as number[],
};

export const ProvinceComponent = {
	provinceId: [] as number[],
	face: [] as ProvinceFace[],
	provinceCentroid: [] as Vec2[],
	provinceEdges: [] as Vec2[][][]
};

export const MoveRequestComponent = 
{
	toFace: [] as number[],
}

export const PathComponent = 
{
	path: [] as number[][]
}

export const Dirty = {}
export const VisibleTag = {}

export const Selected = {};
export const Hovered = {};
export const Owned = {};


