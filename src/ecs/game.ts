import { addComponent, addComponents, addEntity, createWorld, query, removeEntity, type World } from 'bitecs';
import type { ActorSnapshot } from '../shared/protocol';
import { ActorComponent, Dirty, RenderableComponent, TerrainLocationComponent } from './components';

export type EcsGame = {
	world: World;
	tick: (dt: number) => void;
};

export type TGame = EcsGame;

export type EcsPipeline = {
	tick: (dt: number) => void;
};

export function createEcsGame(): EcsGame
{
	const world = createWorld();
	return {
		world,
		tick(dt: number): void
		{
			(world as any).dt = dt;
		},
	};
}

export function createGame(): EcsGame
{
	return createEcsGame();
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

export function findActorEntityById(world: World, actorId: number): number | null
{
	for (const eid of query(world, [ActorComponent]))
	{
		if (ActorComponent.netId[eid] === actorId)
		{
			return eid;
		}
	}
	return null;
}

export function ensureActorEntity(world: World, actorId: number, ownerId: number): number
{
	const existing = findActorEntityById(world, actorId);
	if (existing !== null)
	{
		ActorComponent.ownerId[existing] = ownerId;
		return existing;
	}

	const entity = addEntity(world);
	addComponents(world, entity, ActorComponent, TerrainLocationComponent, RenderableComponent);
	ActorComponent.netId[entity] = actorId;
	ActorComponent.ownerId[entity] = ownerId;
	TerrainLocationComponent.faceId[entity] = 0;
	RenderableComponent.sprite[entity] = 'unit_cb_02';
	RenderableComponent.color[entity] = 0xffce54;
	addComponent(world, entity, Dirty);
	return entity;
}

export function removeActorEntity(world: World, eid: number): void
{
	removeEntity(world, eid);
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
