/**
 * Browser runtime for `/game` mode.
 * Key runtime branches:
 * - terrain snapshot application (authoritative generation controls)
 * - world snapshot acceptance gates (terrain version + sequence monotonicity)
 * - pointer interaction branch for actor selection vs province selection
 */
import { addComponent, addEntity, hasComponent, observe, onSet, query, removeComponent, removeEntity, setComponent, World } from 'bitecs';
import { Ticker, UPDATE_PRIORITY } from 'pixi.js';
import { createClientPipeline, createEcsGame, ensureActorEntity, type EcsPipeline, type EcsGame } from '../../ecs/game';
import { ActorComponent, Hovered, Owned, MoveRequestComponent, ProvinceComponent, RenderableComponent, Selected, TerrainLocationComponent, PathComponent } from '../../ecs/components';
import { GameRenderer } from '../rendering/game-renderer';
import type { TerrainRenderControls } from '../rendering/render-controls';
import type { TerrainGenerationState } from '../../terrain/types';
import type { ActorSnapshot, TerrainSnapshot, WorldSnapshotMessage } from '../../shared/protocol';
import { SharedTerrainRuntime } from './shared-terrain-runtime';
import { buildProvincePickModel, pickFaceIndexAt, pickProvinceIndexAt as pickProvinceFromModel, type ProvincePickModel } from './province-pick';
import { buildBorder as buildProvinceEdges, calculateProvinceCentroid } from '../rendering/terrain-presentation';
import { TerrainMeshState } from '../../terrain/core/terrain-core';
import { vec2Dist, vec2Len } from '../../terrain/core/math';

export type GameConfig = {
	width: number;
	height: number;
};

type Vec2 = { x: number; y: number };

export class ClientGame
{
	private readonly config: GameConfig;
	private hoveredProvinceId: number | null = null;
	private selectedProvinceId: number | null = null;
	private provinceEntitiesInitialized = false;

	private localPlayerId: number | null = null;
	private selectedEntity: number | null = null;
	private hoveredActorId: number | null = null;
	private serverClockOffsetMs = 0;
	private hasServerClockOffset = false;
	private lastWorldSnapshotSeq = -1;

	private readonly terrainGen: SharedTerrainRuntime;
	private terrainState: TerrainGenerationState | null = null;
	private pickModel: ProvincePickModel | null = null;
	private readonly r: GameRenderer;
	private ticker: Ticker;
	private readonly game: EcsGame;
	private readonly clientPipeline: EcsPipeline;

	// province
	private readonly provinceEntityById = new Map<number, number>();

	constructor(config: GameConfig)
	{
		this.config = config;
		this.r = new GameRenderer();
		this.ticker = this.r.app.ticker;

		this.terrainGen = new SharedTerrainRuntime({
			width: config.width,
			height: config.height,
		});
		this.game = createEcsGame();
		this.clientPipeline = createClientPipeline(this.game);
	}

	async init(field: HTMLElement | null): Promise<void>
	{
		await this.r.init(this.config.width, this.config.height, window.devicePixelRatio || 1, field);
		await this.r.hookGame(this.game);

		this.ticker = this.r.app.ticker;

		observe(this.game.world, onSet(TerrainLocationComponent), (eid, params) =>
		{
			const currentFacePoint = this.getFacePoint(params.faceId);
			if (currentFacePoint)
			{
				RenderableComponent.x[eid] = currentFacePoint.x;
				RenderableComponent.y[eid] = currentFacePoint.y;
			}

			TerrainLocationComponent.faceId[eid] = params.faceId;
		});

		this.ticker.add((ticker) =>
		{
			this.clientPipeline.tick(ticker.deltaTime);
			this.r.renderView(this.game);
		});

		//TODO move into runtime navigation module
		this.ticker.add((ticker) =>
		{
			if (!this.terrainState)
				return;

			for (const eid of query(this.game.world, [MoveRequestComponent, TerrainLocationComponent]))
			{
				let path = this.findPath(this.terrainState.mesh, TerrainLocationComponent.faceId[eid], MoveRequestComponent.toFace[eid]);
				console.log("Pathfinding from {} to {}", TerrainLocationComponent.faceId[eid], MoveRequestComponent.toFace[eid], path);
				if (path)
				{
					if (!hasComponent(this.game.world, eid, PathComponent))
					{
						addComponent(this.game.world, eid, PathComponent)
					}

					PathComponent.path[eid] = path;
				}

				removeComponent(this.game.world, eid, MoveRequestComponent);
			}
		});		

		this.ticker.add((ticker) =>
			{
				if (this.terrainState)
				{
					this.r.renderDebug(this.terrainState)
				}				
			},
			undefined,
			UPDATE_PRIORITY.UTILITY,
		);

		this.r.bindCanvasEvent('pointermove', this.pointerMove);
		this.r.bindCanvasEvent('pointerleave', this.pointerLeave);
		this.r.bindCanvasEvent('pointerdown', this.pointerDown);
		this.r.bindCanvasEvent('contextmenu', this.contextMenu);
	}

	setTerrainRenderControls(nextControls: TerrainRenderControls): void
	{
		const result = this.r.setTerrainRenderControls(nextControls);
		if (!this.terrainState || !result.changed)
		{
			return;
		}
		if (result.refinementChanged)
		{
			this.r.renderTerrainOnce(
				this.terrainGen.mapWidth,
				this.terrainGen.mapHeight,
				this.terrainState);
		}
	}

	bindUtilityTick(onFrame: (dt: number, fps: number) => void): void
	{
		this.ticker.add(
			(ticker) =>
			{
				onFrame(ticker.deltaTime, ticker.FPS);
			},
			undefined,
			UPDATE_PRIORITY.UTILITY
		);
	}

	setLocalPlayerId(playerId: number | null): void
	{
		this.localPlayerId = playerId;
	}

	getTerrainVersion(): number
	{
		return this.terrainGen.getTerrainVersion();
	}

	applyTerrainSnapshot(snapshot: TerrainSnapshot, terrainVersion: number): void
	{
		this.lastWorldSnapshotSeq = -1;
		this.pickModel = null;
		this.terrainState = this.terrainGen.applyTerrainSnapshot(snapshot, terrainVersion);
		
		if (this.terrainState)
		{
			this.makeProvinceEntities();

			this.pickModel = buildProvincePickModel(
				{ width: this.terrainGen.mapWidth, height: this.terrainGen.mapHeight },
				this.terrainState,
				this.game.world
			);

			this.r.renderTerrainOnce(
				this.terrainGen.mapWidth,
				this.terrainGen.mapHeight,
				this.terrainState
			);	
		}
	}

	applyWorldSnapshot(snapshot: WorldSnapshotMessage): void
	{
		if (!this.terrainState)
		{
			throw new Error('Received world snapshot before terrain snapshot.');
		}
		if (
			!this.terrainState ||
			snapshot.terrainVersion !== this.terrainGen.getTerrainVersion()
		)
		{
			return;
		}
		if (snapshot.snapshotSeq <= this.lastWorldSnapshotSeq)
		{
			return;
		}
		this.lastWorldSnapshotSeq = snapshot.snapshotSeq;
		const clientReceiveMs = Date.now();
		this.updateServerClockOffset(snapshot.serverTime, clientReceiveMs);

		for (let i = 0; i < snapshot.actors.length; i += 1)
		{
			const actorSnapshot = snapshot.actors[i];
			const actorEntity = ensureActorEntity(this.game.world, actorSnapshot.actorId, actorSnapshot.ownerId);
			setComponent(this.game.world, actorEntity, TerrainLocationComponent, { faceId: actorSnapshot.currentFace });
		}

		const staleActorIds: number[] = [];
		void staleActorIds;
	}

	public getPointerCanvasPosition(event: PointerEvent): Vec2
	{
		const canvas = this.r.app.canvas;

		if (!canvas || !canvas.getBoundingClientRect)
		{
			return { x: 0, y: 0 };
		}

		const rect = canvas.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0)
		{
			return { x: 0, y: 0 };
		}

		const scaleX = this.config.width / rect.width;
		const scaleY = this.config.height / rect.height;

		return {
			x: (event.clientX - rect.left) * scaleX,
			y: (event.clientY - rect.top) * scaleY,
		};
	}

	private pointerMove = (event: PointerEvent) =>
	{
		const position = this.getPointerCanvasPosition(event);
		let hoveredEntity : number | null;
		
		hoveredEntity = this.getActorIdAt(this.game.world, position.x, position.y) ?? this.pickProvinceAt(position.x, position.y);
		this.setHoveredEntity(hoveredEntity);
	};

	private pointerLeave = () =>
	{
		this.setHoveredEntity(null);
	};

	private pointerDown = (event: PointerEvent) =>
	{
		const position = this.getPointerCanvasPosition(event);
		let hoveredEntity : number | null;

		if (event.button === 0)
		{
			hoveredEntity = this.getActorIdAt(this.game.world, position.x, position.y) ?? this.pickProvinceAt(position.x, position.y);
			this.setSelectedEntity(hoveredEntity);
		}

		if (event.button === 2)
		{
			const targetFace = this.pickModel ? pickFaceIndexAt(this.pickModel, position.x, position.y) : -1;
			if (targetFace > -1)
			{
				for (const entity of query(this.game.world, [Selected, TerrainLocationComponent, ActorComponent, Owned]))
				{
					addComponent(this.game.world, entity, MoveRequestComponent);
					MoveRequestComponent.toFace[entity] = targetFace;
				}
			}
		}
	};

	private setHoveredEntity(hoveredEntity: number | null): void
	{
		if (this.hoveredActorId !== null)
		{
			removeComponent(this.game.world, this.hoveredActorId, Hovered);
		}
		if (hoveredEntity !== null)
		{
			addComponent(this.game.world, hoveredEntity, Hovered);
		}
		this.hoveredActorId = hoveredEntity;
	}

	private setSelectedEntity(selectedEntity: number | null): void
	{
		if (this.selectedEntity !== null)
		{
			removeComponent(this.game.world, this.selectedEntity, Selected);
		}
		if (selectedEntity !== null)
		{
			addComponent(this.game.world, selectedEntity, Selected);
		}
		this.selectedEntity = selectedEntity;
	}

	private makeProvinceEntities(): void
	{
		if (this.provinceEntitiesInitialized || !this.terrainState)
		{
			return;
		}
		const provinceCount = this.terrainState.provinces.faces.length;
		if (provinceCount === undefined)
		{
			return;
		}

		for (let provinceId = 0; provinceId < provinceCount; provinceId += 1)
		{
			const entity = addEntity(this.game.world);
			addComponent(this.game.world, entity, ProvinceComponent);
			ProvinceComponent.provinceId[entity] = provinceId;
			ProvinceComponent.face[entity] = this.terrainState.provinces.faces[provinceId];
			ProvinceComponent.provinceCentroid[entity] = calculateProvinceCentroid(provinceId, this.terrainState);
			ProvinceComponent.provinceEdges[entity] = buildProvinceEdges(provinceId, this.terrainState )
			this.provinceEntityById.set(provinceId, entity);
		}

		this.provinceEntitiesInitialized = true;
	}

	getActorIdAt(world: World, worldX: number, worldY: number): number | null
	{
		const eids = query(world, [ActorComponent, RenderableComponent]);

		const distancesSq: number[] = new Array(eids.length);

		for (let i = 0; i < eids.length; i++)
		{
			const eid = eids[i];
			const dx = worldX - (RenderableComponent.x[eid] ?? 0);
			const dy = worldY - (RenderableComponent.y[eid] ?? 0);
			distancesSq[i] = dx * dx + dy * dy;
		}

		const maxDistSq = 100;
		let bestId: number | null = null;
		let bestDistanceSq = Number.POSITIVE_INFINITY;

		for (let i = 0; i < eids.length; i++)
		{
			const d = distancesSq[i];
			if (d <= maxDistSq && d < bestDistanceSq)
			{
				bestDistanceSq = d;
				bestId = eids[i];
			}
		}

		return bestId;
	}

	private contextMenu = (event: MouseEvent) =>
	{
		event.preventDefault();
	};

	private getFacePoint(faceId: number): Vec2 | null
	{
		if (!this.terrainState)
		{
			return null;
		}
		const face = this.terrainState.mesh.faces[faceId];
		if (!face)
		{
			return null;
		}
		return { x: face.point.x, y: face.point.y };
	}

	private updateServerClockOffset(serverTimeMs: number, clientReceiveMs: number): void
	{
		if (!Number.isFinite(serverTimeMs) || !Number.isFinite(clientReceiveMs))
		{
			return;
		}
		const observedOffset = serverTimeMs - clientReceiveMs;
		if (!this.hasServerClockOffset)
		{
			this.serverClockOffsetMs = observedOffset;
			this.hasServerClockOffset = true;
			return;
		}
		const alpha = 0.1;
		this.serverClockOffsetMs = this.serverClockOffsetMs * (1 - alpha) + observedOffset * alpha;
	}

	private getEstimatedServerNow(clientNow: number): number
	{
		if (!this.hasServerClockOffset)
		{
			return clientNow;
		}
		return clientNow + this.serverClockOffsetMs;
	}

	private pickProvinceAt(worldX: number, worldY: number): number | null
	{
		if (!this.pickModel)
		{
			return null;
		}

		return pickProvinceFromModel(this.pickModel, worldX, worldY);
	}

	private heuristic(mesh: TerrainMeshState, fromFace: number, toFace: number) : number
	{
		return vec2Dist(mesh.faces[fromFace].point, mesh.faces[toFace].point);
	}

	private transitionCost(
		mesh: TerrainMeshState,
		fromFace: number,
		toFace: number,
	): number
	{
		const geometric = vec2Dist(mesh.faces[fromFace].point, mesh.faces[toFace].point);

		//const facePenalty = costModel?.faceEnterCost?.(toFace) ?? 0;
		//const edgePenalty = costModel?.edgeCrossCost?.(viaEdge, fromFace, toFace) ?? 0;
		const facePenalty = 0;
		const edgePenalty = 0;
		return geometric + facePenalty + edgePenalty;
	}

	private findPath(mesh: TerrainMeshState, fromFace: number, toFace:number) : number[] | null
	{
		if (fromFace == toFace)
		{
			return null;
		}

		const n = mesh.faces.length;
		const gScore = new Float64Array(n);
		const fScore = new Float64Array(n);
		
		const cameFrom = new Int32Array(n);
		const inOpen = new Uint8Array(n);

		for (let i = 0; i < n; i++)
		{
			gScore[i] = fScore[i] = Infinity;
			cameFrom[i] = -1;
		}

		gScore[fromFace] = 0;
		fScore[fromFace] = this.heuristic(mesh, fromFace, toFace);  

		const openList: number[] = [fromFace];
  		inOpen[fromFace] = 1;

		while (openList.length > 0)
		{
			let bestIdx = 0;
			let current = openList[0];
			for (let i = 1; i < openList.length; i++)
			{
				const candidate = openList[i];
				if (fScore[candidate] < fScore[current])
				{
					current = candidate;
					bestIdx = i;
				}
			}

			openList.splice(bestIdx, 1);
			inOpen[current] = 0;

			if (current == toFace)
			{
				return this.constructPath(toFace, cameFrom);
			}

			let adjacentCount = mesh.faces[current].adjacentFaces.length;
			for (let adjacentId = 0; adjacentId < adjacentCount; adjacentId++)
			{
				const adjacentFace = mesh.faces[current].adjacentFaces[adjacentId];
				//const adEdge = mesh.faces[current].sharedEdges[adjacentId];
				const tentativeG = gScore[current] + this.transitionCost(mesh, fromFace, adjacentFace);

				if (tentativeG < gScore[adjacentFace])
				{
					cameFrom[adjacentFace] = current;
					gScore[adjacentFace] = tentativeG;
					fScore[adjacentFace] = tentativeG + this.heuristic(mesh, adjacentFace, toFace);

					if (!inOpen[adjacentFace])
					{
						openList.push(adjacentFace);
						inOpen[adjacentFace] = 1;
					}
				}
			}
		}
		
		return null;
	}

	private constructPath(toFace: number, cameFrom: Int32Array<ArrayBuffer>)
	{
		const path: number[] = [];
		let currentStep = toFace;
		while (currentStep !== -1)
		{
			path.push(currentStep);
			currentStep = cameFrom[currentStep];
		}

		path.reverse();
		return path;
	}
}
