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
	sprite: [] as string[],
	x: [] as number[],
	y: [] as number[],
};

export const Dirty = {}

export const VisibleTag = {}

export const RenderableInfoComponent = {
	sprite: [] as string[],
	scale: [] as number[],
	anchor: [] as number[]
};