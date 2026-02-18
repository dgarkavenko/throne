/**
 * Browser runtime for `/game` mode.
 * Key runtime branches:
 * - terrain snapshot application (authoritative generation controls)
 * - world snapshot acceptance gates (terrain version + sequence monotonicity)
 * - pointer interaction branch for actor selection vs province selection
 */
import { addComponent, observe, onSet, query, removeComponent, setComponent, World } from 'bitecs';
import { Container, Graphics, Ticker, UPDATE_PRIORITY } from 'pixi.js';
import
	{
		createClientPipeline,
		createEcsGame,
		ensureActorEntity,
		
		type EcsPipeline,
		type EcsGame,
		
		findActorEntityByNetId,
	} from '../../ecs/game';
import { ActorComponent, Hovered, RenderableComponent, Selected, TerrainLocationComponent } from '../../ecs/components';
import { GameRenderer } from '../rendering/game-renderer';
import { DEFAULT_TERRAIN_RENDER_CONTROLS, type TerrainRenderControls } from '../terrain/render-controls';
import type { ActorSnapshot, TerrainSnapshot, WorldSnapshotMessage } from '../../shared/protocol';
import {
	SharedTerrainRuntime,
	type TerrainNavigationConfig,
} from './shared-terrain-runtime';

export type GameConfig = {
	width: number;
	height: number;
};

type Vec2 = { x: number; y: number };

type ProvinceInteractionModel = {
	facePolygons: Vec2[][];
	faceAabbs: Array<{ minX: number; minY: number; maxX: number; maxY: number }>;
	gridSize: number;
	gridColumns: number;
	gridRows: number;
	grid: Map<number, number[]>;
	provinceByFace: number[];
	isLand: boolean[];
	provinceCentroids: Array<Vec2 | null>;
	provinceBorderPaths: Vec2[][][];
};

type ProvinceInteractionOverlay = {
	container: any;
	hoverGraphics: any;
	selectedGraphics: any;
	neighborGraphics: any;
};

type MovementConfig = {
	enabled: boolean;
	unitCount: number;
} & TerrainNavigationConfig & {
	spacingTarget: number;
};

export class ClientGame
{
	private readonly config: GameConfig;
	private provinceInteractionModel: ProvinceInteractionModel | null = null;
	private provinceInteractionOverlay: ProvinceInteractionOverlay | null = null;
	private hoveredProvinceId: number | null = null;
	private selectedProvinceId: number | null = null;
	private selectionListeners = new Set<(provinceId: number | null) => void>();

	private localPlayerId: number | null = null;
	private selectedActorId: number | null = null;
	private hoveredActorId: number | null = null;
	private movementTestConfig: MovementConfig = {
		enabled: false,
		unitCount: 8,
		timePerFaceSeconds: 180,
		lowlandThreshold: 10,
		impassableThreshold: 28,
		elevationPower: 0.8,
		elevationGainK: 1,
		riverPenalty: 0.8,
		spacingTarget: 16,
	};
	private serverClockOffsetMs = 0;
	private hasServerClockOffset = false;
	private lastWorldSnapshotSeq = -1;

	private readonly terrain: SharedTerrainRuntime;
	private readonly r: GameRenderer;
	private ticker: Ticker;
	private readonly game: EcsGame;
	private readonly clientPipeline: EcsPipeline;

	constructor(config: GameConfig)
	{
		this.config = config;
		this.r = new GameRenderer();
		this.ticker = this.r.app.ticker;

		this.terrain = new SharedTerrainRuntime({
			width: config.width,
			height: config.height,
			terrainLayer: this.r.terrainLayer,
		});
		this.game = createEcsGame();
		this.clientPipeline = createClientPipeline(this.game);
	}

	async init(field: HTMLElement | null): Promise<void>
	{
		await this.r.init(this.config.width, this.config.height, window.devicePixelRatio || 1, field);
		await this.r.hook(this.game);

		this.ticker = this.r.app.ticker;

		observe(this.game.world, onSet(TerrainLocationComponent), (eid, params) =>
		{
			const currentFacePoint = this.getFacePoint(params.faceId);
			if (currentFacePoint)
			{
				RenderableComponent.x[eid] = currentFacePoint.x;
				RenderableComponent.y[eid] = currentFacePoint.y;
			}
			return params;
		});

		this.ticker.add
		(			
			(ticker) =>
			{
				this.clientPipeline.tick(ticker.deltaTime);
				this.r.syncView(this.game);
			}
		);

		this.r.bindCanvasEvent('pointermove', this.pointerMove);
		this.r.bindCanvasEvent('pointerleave', this.pointerLeave);
		this.r.bindCanvasEvent('pointerdown', this.pointerDown);
		this.r.bindCanvasEvent('contextmenu', this.contextMenu);
	}

	setTerrainRenderControls(nextControls: TerrainRenderControls): void
	{
		this.terrain.setTerrainRenderControls(nextControls);
		this.renderProvinceInteractionOverlay();
	}

	setMovementConfig(nextConfig: Partial<MovementConfig>): void
	{
		const hasCostConfig =
			typeof nextConfig.lowlandThreshold === 'number' ||
			typeof nextConfig.impassableThreshold === 'number' ||
			typeof nextConfig.elevationPower === 'number' ||
			typeof nextConfig.elevationGainK === 'number' ||
			typeof nextConfig.riverPenalty === 'number';
		this.movementTestConfig = {
			...this.movementTestConfig,
			...nextConfig,
		};
		if (hasCostConfig)
		{
			this.terrain.setNavigationConfig(nextConfig);
		}
	}

	bindUtilityTick(onFrame: (dt: number, fps: number) => void): void {
		this.ticker.add
			(
				(ticker) => {
					onFrame(ticker.deltaTime, ticker.FPS)
				}
				, undefined
				, UPDATE_PRIORITY.UTILITY
			);
	}

	setLocalPlayerId(playerId: number | null): void
	{
		this.localPlayerId = playerId;
	}

	getTerrainVersion(): number
	{
		return this.terrain.state.lastTerrainVersion;
	}

	onProvinceSelectionChange(listener: (provinceId: number | null) => void): () => void
	{
		this.selectionListeners.add(listener);
		return () =>
		{
			this.selectionListeners.delete(listener);
		};
	}

	applyTerrainSnapshot(snapshot: TerrainSnapshot, terrainVersion: number): void
	{
		this.lastWorldSnapshotSeq = -1;
		this.terrain.applyTerrainSnapshot(snapshot, terrainVersion);
		this.rebuildProvinceInteractionModel();
		this.renderProvinceInteractionOverlay();
	}

	applyWorldSnapshot(snapshot: WorldSnapshotMessage): void
	{
		if (!this.terrain.state.navigationGraph || !this.terrain.state.terrainState)
		{
			throw new Error('Received world snapshot before terrain snapshot.');
		}
		if (
			!this.terrain.state.navigationGraph ||
			!this.terrain.state.terrainState ||
			snapshot.terrainVersion !== this.terrain.state.lastTerrainVersion
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
		const estimatedServerNow = this.getEstimatedServerNow(clientReceiveMs);
		const liveActorIds = new Set<number>();
		for (let i = 0; i < snapshot.actors.length; i += 1)
		{
			const actorSnapshot = snapshot.actors[i];
			liveActorIds.add(actorSnapshot.actorId);
			const actorEntity = ensureActorEntity(this.game.world, actorSnapshot.actorId, actorSnapshot.ownerId);
			this.syncUnitFromSnapshot(actorEntity, actorSnapshot, estimatedServerNow, clientReceiveMs);
		}
		
		const staleActorIds: number[] = [];

	}

	public getPointerCanvasPosition(event: PointerEvent): Vec2
	{
		const canvas = this.r.app.canvas;
		
		if (!canvas || !canvas.getBoundingClientRect)
		{
			return {x:0, y:0};
		}

		const rect = canvas.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0)
		{
			return {x:0, y:0};
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
		console.log("pointer move");

		const hoveredActorId = this.getActorIdAt(this.game.world, position.x, position.y);
		this.setHoveredActor(hoveredActorId);		
	};

	private pointerLeave = () =>
	{
		this.setHoveredActor(null);
	};

	private pointerDown = (event: PointerEvent) =>
	{
		const position = this.getPointerCanvasPosition(event);

		if (event.button === 0)
		{
			const actorId = this.getActorIdAt(this.game.world, position.x, position.y);
			this.setSelectedActor(actorId);			
		}
		if (event.button === 2)
		{
			return;
		}
	};
	
	private setHoveredActor(hoveredActor: number | null)
	{
		if (this.hoveredActorId)
			removeComponent(this.game.world, this.hoveredActorId, Hovered);

		if (hoveredActor)
			addComponent(this.game.world, hoveredActor, Hovered);

		this.hoveredActorId = hoveredActor;
	}
	
	private setSelectedActor(selectedActor: number | null): void
	{
		if (this.selectedActorId)
			removeComponent(this.game.world, this.selectedActorId, Selected);

		if (selectedActor)
			addComponent(this.game.world, selectedActor, Selected);

		this.selectedActorId = selectedActor;
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

	private rebuildProvinceInteractionModel(): void
	{
		const terrainState = this.terrain.state.terrainState;
		if (!terrainState)
		{
			this.provinceInteractionModel = null;
			return;
		}
		const { mesh: meshState, provinces } = terrainState;
		const mesh = meshState.mesh;
		const faceCount = mesh.faces.length;
		const facePolygons: Vec2[][] = new Array(faceCount);
		const faceAabbs: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = new Array(faceCount);
		const generationControls = this.terrain.state.generationControls;
		const gridSize = Math.max(32, generationControls.spacing * 2);
		const gridColumns = Math.max(1, Math.ceil(this.config.width / gridSize));
		const gridRows = Math.max(1, Math.ceil(this.config.height / gridSize));
		const grid = new Map<number, number[]>();

		for (let i = 0; i < faceCount; i += 1)
		{
			const baseCell = meshState.baseCells[i];
			const cell = baseCell;
			if (!cell || cell.length < 3)
			{
				facePolygons[i] = [];
				faceAabbs[i] = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
				continue;
			}
			facePolygons[i] = cell;
			let minX = cell[0].x;
			let maxX = cell[0].x;
			let minY = cell[0].y;
			let maxY = cell[0].y;
			for (let j = 1; j < cell.length; j += 1)
			{
				const point = cell[j];
				minX = Math.min(minX, point.x);
				maxX = Math.max(maxX, point.x);
				minY = Math.min(minY, point.y);
				maxY = Math.max(maxY, point.y);
			}
			faceAabbs[i] = { minX, minY, maxX, maxY };
			const startX = Math.max(0, Math.floor(minX / gridSize));
			const endX = Math.min(gridColumns - 1, Math.floor(maxX / gridSize));
			const startY = Math.max(0, Math.floor(minY / gridSize));
			const endY = Math.min(gridRows - 1, Math.floor(maxY / gridSize));
			for (let gx = startX; gx <= endX; gx += 1)
			{
				for (let gy = startY; gy <= endY; gy += 1)
				{
					const key = gx + gy * gridColumns;
					const bucket = grid.get(key);
					if (bucket)
					{
						bucket.push(i);
					} else
					{
						grid.set(key, [i]);
					}
				}
			}
		}

		const provinceCentroids: Array<Vec2 | null> = new Array(provinces.faces.length).fill(null);
		provinces.faces.forEach((province, index) =>
		{
			if (!province.faces || province.faces.length === 0)
			{
				provinceCentroids[index] = null;
				return;
			}
			let sumX = 0;
			let sumY = 0;
			let count = 0;
			province.faces.forEach((faceIndex) =>
			{
				const point = mesh.faces[faceIndex]?.point;
				if (!point)
				{
					return;
				}
				sumX += point.x;
				sumY += point.y;
				count += 1;
			});
			provinceCentroids[index] = count > 0 ? { x: sumX / count, y: sumY / count } : null;
		});

		const provinceBorderPaths: Vec2[][][] = new Array(provinces.faces.length);
		provinces.faces.forEach((province, index) =>
		{
			const segments: Vec2[][] = [];
			province.outerEdges.forEach((edgeIndex) =>
			{
				const outerEdge = provinces.outerEdges[edgeIndex];
				const edge = mesh.edges[outerEdge.edge];
				if (!edge)
				{
					return;
				}
				const a = mesh.vertices[edge.vertices[0]]?.point;
				const b = mesh.vertices[edge.vertices[1]]?.point;
				if (!a || !b)
				{
					return;
				}
				segments.push([a, b]);
			});
			provinceBorderPaths[index] = segments;
		});

		this.provinceInteractionModel = {
			facePolygons,
			faceAabbs,
			gridSize,
			gridColumns,
			gridRows,
			grid,
			provinceByFace: provinces.provinceByFace,
			isLand: provinces.isLand,
			provinceCentroids,
			provinceBorderPaths,
		};
		this.hoveredProvinceId = null;
		this.selectedProvinceId = null;
	}

	private ensureProvinceInteractionOverlay(): ProvinceInteractionOverlay | null
	{
		if (this.provinceInteractionOverlay)
		{
			const overlayContainer = this.terrain.getOverlayContainer();
			const meshIndex = overlayContainer ? this.r.terrainLayer.children.indexOf(overlayContainer) : -1;
			if (meshIndex >= 0)
			{
				const targetIndex = Math.max(0, meshIndex - 1);
				this.r.terrainLayer.setChildIndex(this.provinceInteractionOverlay.container, targetIndex);
			}
			return this.provinceInteractionOverlay;
		}
		const container = new Container();
		const neighborGraphics = new Graphics();
		const hoverGraphics = new Graphics();
		const selectedGraphics = new Graphics();
		container.addChild(neighborGraphics);
		container.addChild(hoverGraphics);
		container.addChild(selectedGraphics);
		const overlayContainer = this.terrain.getOverlayContainer();
		const meshIndex = overlayContainer ? this.r.terrainLayer.children.indexOf(overlayContainer) : -1;
		if (meshIndex >= 0)
		{
			this.r.terrainLayer.addChildAt(container, Math.max(0, meshIndex));
		} else
		{
			this.r.terrainLayer.addChild(container);
		}
		this.provinceInteractionOverlay = { container, hoverGraphics, selectedGraphics, neighborGraphics };
		return this.provinceInteractionOverlay;
	}

	private renderProvinceInteractionOverlay(): void
	{
		const overlay = this.ensureProvinceInteractionOverlay();
		if (!overlay || !this.provinceInteractionModel)
		{
			return;
		}
		overlay.hoverGraphics.clear();
		overlay.selectedGraphics.clear();
		overlay.neighborGraphics.clear();

		const borderWidth = this.terrain.state.renderControls.provinceBorderWidth
			?? DEFAULT_TERRAIN_RENDER_CONTROLS.provinceBorderWidth;
		const hoverWidth = Math.max(1, borderWidth * 0.6);
		const selectedWidth = Math.max(2, borderWidth * 0.95);

		if (this.hoveredProvinceId !== null)
		{
			const segments = this.provinceInteractionModel.provinceBorderPaths[this.hoveredProvinceId];
			if (segments && segments.length > 0)
			{
				this.drawProvinceBorder(overlay.hoverGraphics, segments, 0xdcecff, 0.5, hoverWidth);
			}
		}

		if (this.selectedProvinceId !== null)
		{
			const segments = this.provinceInteractionModel.provinceBorderPaths[this.selectedProvinceId];
			if (segments && segments.length > 0)
			{
				this.drawProvinceBorder(overlay.selectedGraphics, segments, 0xffffff, 0.95, selectedWidth);
			}
			const center = this.provinceInteractionModel.provinceCentroids[this.selectedProvinceId];
			const neighbors = this.terrain.state.terrainState?.provinces.faces[this.selectedProvinceId]?.adjacentProvinces ?? [];
			if (center && neighbors.length > 0)
			{
				neighbors.forEach((neighborId) =>
				{
					const neighborCenter = this.provinceInteractionModel?.provinceCentroids[neighborId];
					if (!neighborCenter)
					{
						return;
					}
					overlay.neighborGraphics.moveTo(center.x, center.y);
					overlay.neighborGraphics.lineTo(neighborCenter.x, neighborCenter.y);
				});
				overlay.neighborGraphics.stroke({ width: Math.max(1.5, borderWidth * 0.5), color: 0xffffff, alpha: 0.6 });
			}
		}
	}

	private drawProvinceBorder(
		graphics: any,
		segments: Vec2[][],
		color: number,
		alpha: number,
		width: number
	): void
	{
		segments.forEach((segment) =>
		{
			if (!segment || segment.length < 2)
			{
				return;
			}
			graphics.moveTo(segment[0].x, segment[0].y);
			for (let i = 1; i < segment.length; i += 1)
			{
				graphics.lineTo(segment[i].x, segment[i].y);
			}
		});
		graphics.stroke({ width, color, alpha });
	}

	private pickFaceAt(worldX: number, worldY: number): number | null
	{
		const model = this.provinceInteractionModel;
		if (!model)
		{
			return null;
		}
		const gridX = Math.floor(worldX / model.gridSize);
		const gridY = Math.floor(worldY / model.gridSize);
		if (gridX < 0 || gridY < 0 || gridX >= model.gridColumns || gridY >= model.gridRows)
		{
			return null;
		}
		const key = gridX + gridY * model.gridColumns;
		const candidates = model.grid.get(key);
		if (!candidates || candidates.length === 0)
		{
			return null;
		}
		for (let i = 0; i < candidates.length; i += 1)
		{
			const faceIndex = candidates[i];
			const bounds = model.faceAabbs[faceIndex];
			if (
				worldX < bounds.minX ||
				worldX > bounds.maxX ||
				worldY < bounds.minY ||
				worldY > bounds.maxY
			)
			{
				continue;
			}
			const polygon = model.facePolygons[faceIndex];
			if (!polygon || polygon.length < 3)
			{
				continue;
			}
			if (!this.pointInPolygon(worldX, worldY, polygon))
			{
				continue;
			}
			if (!model.isLand[faceIndex])
			{
				return null;
			}
			return faceIndex;
		}
		return null;
	}

	private pickProvinceAt(worldX: number, worldY: number): number | null
	{
		const faceIndex = this.pickFaceAt(worldX, worldY);
		if (faceIndex === null)
		{
			return null;
		}
		const model = this.provinceInteractionModel;
		if (!model)
		{
			return null;
		}
		const provinceId = model.provinceByFace[faceIndex];
		return provinceId >= 0 ? provinceId : null;
	}

	private pointInPolygon(x: number, y: number, polygon: Vec2[]): boolean
	{
		let inside = false;
		for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1)
		{
			const xi = polygon[i].x;
			const yi = polygon[i].y;
			const xj = polygon[j].x;
			const yj = polygon[j].y;
			const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
			if (intersect)
			{
				inside = !inside;
			}
		}
		return inside;
	}

	private syncUnitFromSnapshot(
		eid: number,
		snapshot: ActorSnapshot,
		_estimatedServerNow: number,
		_clientReceiveMs: number
	): void
	{
		setComponent(this.game.world, eid, TerrainLocationComponent, { faceId: snapshot.currentFace });
	}

	private getFacePoint(faceId: number): Vec2 | null
	{
		if (!this.terrain.state.navigationGraph)
		{
			return null;
		}
		const node = this.terrain.state.navigationGraph.nodes[faceId];
		if (!node)
		{
			return null;
		}
		return { x: node.point.x, y: node.point.y };
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
}
