import { createWorld, addEntity, addComponent, addComponents, query, pipe, observe, onAdd, onRemove, World } from 'bitecs'
import { TerrainLocationComponent, TerrainRouteComponent, ActorComponent, RenderableComponent } from "./components"

export type TGame = {
	world: any;
	tick: (dt: number) => void;
};

export function createGame(): TGame
{
	const world = createWorld();	

	return {
		world,
		tick(dt: number)
		{
			(world as any).dt = dt;
			logQuery(world);
		},
	};
}

export const logQuery = (world : World) =>
{
	const entities = query(world, [ActorComponent, RenderableComponent])

	for (const eid of entities)
	{
		//console.log(eid + " " + ActorComponent.netId[eid] + " " + RenderableComponent.sprite[eid]);
	}
}