import { addComponent, addComponents, addEntity, createWorld, query, removeEntity, type World } from 'bitecs';
import type { ActorSnapshot } from '../shared/protocol';
import { ActorComponent, Dirty, Owned, RenderableComponent, TerrainLocationComponent } from './components';

export type EcsGame = {
	world: World;
};

export type EcsPipeline = {
	tick: (dt: number) => void;
};

export function createEcsGame(): EcsGame
{
	const world = createWorld();
	return {
		world
	};
}

export function createClientPipeline(_game: EcsGame): EcsPipeline
{
	return {
		tick(_dt: number): void
		{
			// Intentionally empty until client ECS systems are moved here.
		},
	};
}

export function createServerPipeline(_game: EcsGame): EcsPipeline
{
	return {
		tick(_dt: number): void
		{
			// Intentionally empty until server ECS systems are moved here.
		},
	};
}

export function findActorEntityByNetId(world: World, netId: number): number | null
{
	for (const eid of query(world, [ActorComponent]))
	{
		if (ActorComponent.netId[eid] === netId)
		{
			return eid;
		}
	}
	return null;
}

export function ensureActorEntity(world: World, netId: number, ownerId: number): number
{
	const existing = findActorEntityByNetId(world, netId);

	if (existing !== null)
	{
		ActorComponent.ownerId[existing] = ownerId;
		return existing;
	}

	const entity = addEntity(world);
	addComponents(world, entity, ActorComponent, TerrainLocationComponent, RenderableComponent, Owned);
	ActorComponent.netId[entity] = netId;
	ActorComponent.ownerId[entity] = ownerId;
	TerrainLocationComponent.faceId[entity] = 0;
	RenderableComponent.content[entity] = 'unit_cb_02';
	RenderableComponent.color[entity] = 0xffce54;
	
	addComponent(world, entity, Dirty);
	return entity;
}

export function collectActorSnapshots(world: World): ActorSnapshot[]
{
	const snapshots: ActorSnapshot[] = [];
	for (const eid of query(world, [ActorComponent, TerrainLocationComponent]))
	{
		snapshots.push({
			actorId: ActorComponent.netId[eid],
			ownerId: ActorComponent.ownerId[eid],
			currentFace: TerrainLocationComponent.faceId[eid],
		});
	}
	snapshots.sort((a, b) => a.actorId - b.actorId);
	return snapshots;
}