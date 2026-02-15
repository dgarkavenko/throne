import type { TerrainGenerationControls } from '../../terrain/controls';
import type { TerrainGenerationDirtyFlags, TerrainGenerationState } from '../../terrain/types';
import type { TerrainRenderControls } from '../terrain/render-controls';
import type { TerrainRenderRefinementState } from '../terrain/refinement-cache';
import { MapSystem } from './map-system';
import type { ActorSnapshot, TerrainSnapshot, WorldSnapshotMessage } from '../types';
import { Container, Graphics } from 'pixi.js';
import { TRenderer as TRenderer } from '../../ecs/renderer';
import {
	createClientPipeline,
	createEcsGame,
	ensureActorEntity,
	removeActorEntity,
	type EcsPipeline,
	type TGame,
} from '../../ecs/game';
import { observe, onSet, setComponent } from 'bitecs';
import { ActorComponent, RenderableComponent, TerrainLocationComponent } from '../../ecs/components';

type GameConfig = {
	width: number;
	height: number;
	colliderScale: number;
	uiOffset: { x: number; y: number };
	autoGenerateTerrain?: boolean;
};

type Vec2 = { x: number; y: number };
type NavigationNode = {
	faceId: number;
	point: Vec2;
	neighbors: Array<{ neighborFaceId: number; stepCost: number }>;
};
type NavigationGraph = {
	nodes: Record<number, NavigationNode>;
	landFaceIds: number[];
};

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

type MeshOverlay = {
	container: any;
	polygonGraph: any;
	dualGraph: any;
	cornerNodes: any;
	centerNodes: any;
	insertedNodes: any;
};

type MovementTestConfig = {
	enabled: boolean;
	unitCount: number;
	timePerFaceSeconds: number;
	lowlandThreshold: number;
	impassableThreshold: number;
	elevationPower: number;
	elevationGainK: number;
	riverPenalty: number;
	showPaths: boolean;
	spacingTarget: number;
};

export class GameEngine
{
	private readonly config: GameConfig;
	private terrainState: TerrainGenerationState | null = null;
	private meshOverlay: MeshOverlay | null = null;
	private provinceInteractionModel: ProvinceInteractionModel | null = null;
	private provinceInteractionOverlay: ProvinceInteractionOverlay | null = null;
	private hoveredProvinceId: number | null = null;
	private selectedProvinceId: number | null = null;
	private selectionListeners = new Set<(provinceId: number | null) => void>();

	private localPlayerId: string | null = null;
	private selectedActorId: string | null = null;
	private hoveredActorId: string | null = null;
	private lastTerrainVersion = 0;
	private actorEntityById = new Map<string, number>();
	private movementTestConfig: MovementTestConfig = {
		enabled: false,
		unitCount: 8,
		timePerFaceSeconds: 180,
		lowlandThreshold: 10,
		impassableThreshold: 28,
		elevationPower: 0.8,
		elevationGainK: 1,
		riverPenalty: 0.8,
		showPaths: true,
		spacingTarget: 16,
	};
	private navigationGraph: NavigationGraph | null = null;
	private serverClockOffsetMs = 0;
	private hasServerClockOffset = false;
	private lastWorldSnapshotSeq = -1;
	private terrainRenderState: TerrainRenderRefinementState | null = null;
	private readonly mapSystem: MapSystem;
	private readonly autoGenerateTerrain: boolean;
	private hasTerrain = false;

	private r: TRenderer;
	private game: TGame;
	private clientPipeline: EcsPipeline;

	constructor(config: GameConfig)
	{
		this.config = config;
		this.mapSystem = new MapSystem({ width: config.width, height: config.height });
		this.autoGenerateTerrain = config.autoGenerateTerrain !== false;
		this.r = new TRenderer();
		this.game = createEcsGame();
		this.clientPipeline = createClientPipeline(this.game);
	}

	async init(field: HTMLElement | null): Promise<void>
	{
		await this.r.init(this.config.width, this.config.height, window.devicePixelRatio || 1, field);
		await this.r.hook(this.game);

		observe(this.game.world, onSet(TerrainLocationComponent), (eid, params) =>
		{
			const currentFacePoint = this.getFacePoint(params.faceId);
			if (currentFacePoint)
			{
				RenderableComponent.x[eid] = currentFacePoint?.x;
				RenderableComponent.y[eid] = currentFacePoint?.y;
			}
			return params;
		});

		this.r.bindCanvasEvent('pointermove', this.pointerMove);
		this.r.bindCanvasEvent('pointerleave', this.pointerLeave);
		this.r.bindCanvasEvent('pointerdown', this.pointerDown);
		this.r.bindCanvasEvent('contextmenu', this.contextMenu);

		if (this.autoGenerateTerrain)
		{
			this.regenerateTerrain();
		}
	}

	setTerrainGenerationControls(nextControls: TerrainGenerationControls): void
	{
		const result = this.mapSystem.setTerrainGenerationControls(nextControls);
		if (!this.hasTerrain)
		{
			this.regenerateTerrain();
			return;
		}
		if (result.changed)
		{
			this.regenerateTerrainPartial(result.dirty);
			return;
		}
		if (this.r.terrainLayer)
		{
			this.renderTerrainState(this.mapSystem.ensureGenerationState());
			this.renderProvinceInteractionOverlay();
		}
	}

	setTerrainRenderControls(nextControls: TerrainRenderControls): void
	{
		const result = this.mapSystem.setTerrainRenderControls(nextControls);
		if (!this.hasTerrain)
		{
			if (this.autoGenerateTerrain)
			{
				this.regenerateTerrain();
			}
			return;
		}
		if (result.changed && this.terrainState)
		{
			this.renderTerrainState(this.terrainState);
			this.renderProvinceInteractionOverlay();
		}
	}

	setMovementTestConfig(nextConfig: Partial<MovementTestConfig>): void
	{
		if (typeof nextConfig.showPaths !== 'boolean')
		{
			return;
		}
		this.movementTestConfig = {
			...this.movementTestConfig,
			showPaths: nextConfig.showPaths,
		};
	}

	bindAndStart(onFrame?: (deltaMs: number, now: number) => void): void
	{
		if (this.r.app)
		{
			this.r.app.ticker.add((ticker: { deltaMS: number }) =>
			{
				this.clientPipeline.tick(ticker.deltaMS);
				this.game.tick(ticker.deltaMS);
				this.r.sync(this.game);

				if (onFrame)
				{
					onFrame(ticker.deltaMS, performance.now());
				}
			});
		}
	}

	getTerrainState(): TerrainGenerationState | null
	{
		return this.terrainState;
	}

	getHoveredProvinceId(): number | null
	{
		return this.hoveredProvinceId;
	}

	getSelectedProvinceId(): number | null
	{
		return this.selectedProvinceId;
	}

	getTerrainVersion(): number
	{
		return this.lastTerrainVersion;
	}

	setLocalPlayerId(playerId: string | null): void
	{
		this.localPlayerId = playerId;
		if (this.selectedActorId && this.getActorOwner(this.selectedActorId) !== this.localPlayerId)
		{
			this.selectedActorId = null;
		}
	}

	setSelectedActor(actorId: string | null): void
	{
		if (actorId && this.getActorOwner(actorId) !== this.localPlayerId)
		{
			return;
		}
		if (this.selectedActorId === actorId)
		{
			return;
		}
		this.selectedActorId = actorId;
	}

	getSelectedActorId(): string | null
	{
		return this.selectedActorId;
	}

	getTerrainSnapshotForReplication(): TerrainSnapshot
	{
		return {
			controls: this.mapSystem.getGenerationControls(),
			mapWidth: this.config.width,
			mapHeight: this.config.height,
		};
	}

	applyTerrainSnapshot(snapshot: TerrainSnapshot, terrainVersion: number): void
	{
		this.lastTerrainVersion = Math.max(0, Math.round(terrainVersion));
		this.lastWorldSnapshotSeq = -1;
		this.setTerrainGenerationControls(snapshot.controls);
	}

	applyWorldSnapshot(snapshot: WorldSnapshotMessage): void
	{
		if (!this.navigationGraph || !this.terrainState || snapshot.terrainVersion !== this.lastTerrainVersion)
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
		const liveActorIds = new Set<string>();
		for (let i = 0; i < snapshot.actors.length; i += 1)
		{
			const actorSnapshot = snapshot.actors[i];
			liveActorIds.add(actorSnapshot.actorId);
			const actorEntity = ensureActorEntity(this.game.world, actorSnapshot.actorId, actorSnapshot.ownerId);
			this.actorEntityById.set(actorSnapshot.actorId, actorEntity);
			this.syncUnitFromSnapshot(actorEntity, actorSnapshot, estimatedServerNow, clientReceiveMs);
		}
		const staleActorIds: string[] = [];
		this.actorEntityById.forEach((_, actorId) =>
		{
			if (!liveActorIds.has(actorId))
			{
				staleActorIds.push(actorId);
			}
		});
		for (let i = 0; i < staleActorIds.length; i += 1)
		{
			this.removeReplicatedActor(staleActorIds[i]);
		}
		if (this.selectedActorId && !this.actorEntityById.has(this.selectedActorId))
		{
			this.selectedActorId = null;
		}
	}

	onProvinceSelectionChange(listener: (provinceId: number | null) => void): () => void
	{
		this.selectionListeners.add(listener);
		return () =>
		{
			this.selectionListeners.delete(listener);
		};
	}

	private regenerateTerrainPartial(flags: TerrainGenerationDirtyFlags): void
	{
		if (!this.r.terrainLayer)
		{
			return;
		}
		const state = this.mapSystem.regeneratePartial(flags);
		this.terrainState = state;
		this.rebuildMovementNavigationAndUnits();
		this.renderTerrainState(state);
		this.rebuildProvinceInteractionModel();
		this.renderProvinceInteractionOverlay();
		this.hasTerrain = true;
	}

	private renderTerrainState(state: TerrainGenerationState): void
	{
		if (!this.r.terrainLayer)
		{
			return;
		}
		this.terrainRenderState = this.mapSystem.render(this.r.terrainLayer);
		const overlay = this.ensureMeshOverlay(this.r.terrainLayer);
		this.renderMeshOverlay(state.mesh.mesh, this.terrainRenderState?.refinedGeometry.insertedPoints ?? [], overlay);
		this.setGraphOverlayVisibility(this.mapSystem.getRenderControls());
	}

	private regenerateTerrain(): void
	{
		if (!this.r.terrainLayer)
		{
			return;
		}
		const state = this.mapSystem.regenerateAll();
		this.terrainState = state;
		this.rebuildMovementNavigationAndUnits();
		this.renderTerrainState(state);
		this.rebuildProvinceInteractionModel();
		this.renderProvinceInteractionOverlay();
		this.hasTerrain = true;
	}

	private pointerMove = (event: PointerEvent) => 
	{
		const position = this.r.getPointerWorldPosition(event);
		if (!position)
		{
			return;
		}
		const hoveredActorId = this.pickActorAt(position.x, position.y);
		if (this.hoveredActorId !== hoveredActorId)
		{
			this.hoveredActorId = hoveredActorId;
		}
		if (hoveredActorId)
		{
			this.setHoveredProvince(null);
			return;
		}
		const nextHover = this.pickProvinceAt(position.x, position.y);
		this.setHoveredProvince(nextHover);
	}

	private pointerLeave = (event: PointerEvent) => 
	{
		this.hoveredActorId = null;
		this.setHoveredProvince(null);
	}

	private pointerDown = (event: PointerEvent) => 
	{
		const position = this.r.getPointerWorldPosition(event);
		if (!position)
		{
			return;
		}
		if (event.button === 0)
		{
			const actorId = this.pickActorAt(position.x, position.y);
			if (actorId && this.getActorOwner(actorId) === this.localPlayerId)
			{
				this.setSelectedActor(actorId);
				this.setSelectedProvince(null);
				return;
			}
			const nextSelection = this.pickProvinceAt(position.x, position.y);
			this.setSelectedProvince(nextSelection);
			return;
		}
		if (event.button === 2)
		{
			return;
		}
	}
	private contextMenu = (event: MouseEvent) =>
	{
		event.preventDefault();
	}

	private rebuildProvinceInteractionModel(): void
	{
		if (!this.terrainState)
		{
			this.provinceInteractionModel = null;
			return;
		}
		const { mesh: meshState, provinces } = this.terrainState;
		const mesh = meshState.mesh;
		const faceCount = mesh.faces.length;
		const facePolygons: Vec2[][] = new Array(faceCount);
		const faceAabbs: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = new Array(faceCount);
		const generationControls = this.mapSystem.getGenerationControls();
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
			const meshIndex = this.meshOverlay?.container
				? this.r.terrainLayer.children.indexOf(this.meshOverlay.container)
				: -1;
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
		const meshIndex = this.meshOverlay?.container
			? this.r.terrainLayer.children.indexOf(this.meshOverlay.container)
			: -1;
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

		const borderWidth = this.mapSystem.getRenderControls().provinceBorderWidth;
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
			const neighbors = this.terrainState?.provinces.faces[this.selectedProvinceId]?.adjacentProvinces ?? [];
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

	pickFaceAt(worldX: number, worldY: number): number | null
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

	pickActorAt(worldX: number, worldY: number): string | null
	{
		let bestId: string | null = null;
		let bestDistanceSq = Number.POSITIVE_INFINITY;
		this.actorEntityById.forEach((eid, actorId) =>
		{
			const dx = worldX - (RenderableComponent.x[eid] ?? 0);
			const dy = worldY - (RenderableComponent.y[eid] ?? 0);
			const distanceSq = dx * dx + dy * dy;
			if (distanceSq <= 100 && distanceSq < bestDistanceSq)
			{
				bestDistanceSq = distanceSq;
				bestId = actorId;
			}
		});
		return bestId;
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

	private setHoveredProvince(provinceId: number | null): void
	{
		if (this.hoveredProvinceId === provinceId)
		{
			return;
		}
		this.hoveredProvinceId = provinceId;
		this.renderProvinceInteractionOverlay();
	}

	private setSelectedProvince(provinceId: number | null): void
	{
		if (this.selectedProvinceId === provinceId)
		{
			return;
		}
		this.selectedProvinceId = provinceId;
		this.renderProvinceInteractionOverlay();
		this.selectionListeners.forEach((listener) => listener(provinceId));
	}

	private rebuildMovementNavigationAndUnits(): void
	{
		this.rebuildMovementNavigationGraph();
	}

	private rebuildMovementNavigationGraph(): void
	{
		if (!this.terrainState)
		{
			this.navigationGraph = null;
			return;
		}

		const { mesh, water } = this.terrainState;
		const nodes: Record<number, NavigationNode> = {};
		const landFaceIds: number[] = [];
		for (let i = 0; i < mesh.mesh.faces.length; i += 1)
		{
			if (!water.isLand[i])
			{
				continue;
			}
			const face = mesh.mesh.faces[i];
			nodes[i] = {
				faceId: i,
				point: { x: face.point.x, y: face.point.y },
				neighbors: face.adjacentFaces
					.filter((neighborFaceId) => water.isLand[neighborFaceId])
					.map((neighborFaceId) => ({ neighborFaceId, stepCost: 1 })),
			};
			landFaceIds.push(i);
		}
		this.navigationGraph = { nodes, landFaceIds };
	}

	private removeReplicatedActor(actorId: string): void
	{
		const eid = this.actorEntityById.get(actorId);
		if (eid === undefined)
		{
			return;
		}
		this.actorEntityById.delete(actorId);
		removeActorEntity(this.game.world, eid);
	}

	private syncUnitFromSnapshot(
		eid: number,
		snapshot: ActorSnapshot,
		estimatedServerNow: number,
		clientReceiveMs: number
	): void
	{
		setComponent(this.game.world, eid, TerrainLocationComponent, {faceId : snapshot.currentFace});		
	}

	private getFacePoint(faceId: number): Vec2 | null
	{
		if (!this.navigationGraph)
		{
			return null;
		}
		const node = this.navigationGraph.nodes[faceId];
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

	private getActorOwner(actorId: string): string | null
	{
		const eid = this.actorEntityById.get(actorId);
		if (eid === undefined)
		{
			return null;
		}
		return ActorComponent.ownerId[eid] ?? null;
	}

	private ensureMeshOverlay(terrainLayer: any): MeshOverlay
	{
		if (this.meshOverlay)
		{
			terrainLayer.setChildIndex(this.meshOverlay.container, terrainLayer.children.length - 1);
			return this.meshOverlay;
		}
		const container = new Container();
		const polygonGraph = new Graphics();
		const dualGraph = new Graphics();
		const cornerNodes = new Graphics();
		const centerNodes = new Graphics();
		const insertedNodes = new Graphics();
		container.addChild(polygonGraph);
		container.addChild(dualGraph);
		container.addChild(cornerNodes);
		container.addChild(centerNodes);
		container.addChild(insertedNodes);
		terrainLayer.addChild(container);
		this.meshOverlay = { container, polygonGraph, dualGraph, cornerNodes, centerNodes, insertedNodes };
		return this.meshOverlay;
	}

	private setGraphOverlayVisibility(controls: TerrainRenderControls): void
	{
		if (!this.meshOverlay)
		{
			return;
		}
		this.meshOverlay.polygonGraph.visible = controls.showPolygonGraph;
		this.meshOverlay.dualGraph.visible = controls.showDualGraph;
		this.meshOverlay.cornerNodes.visible = controls.showCornerNodes;
		this.meshOverlay.centerNodes.visible = controls.showCenterNodes;
		this.meshOverlay.insertedNodes.visible = controls.showInsertedPoints;
		this.meshOverlay.container.visible =
			controls.showPolygonGraph ||
			controls.showDualGraph ||
			controls.showCornerNodes ||
			controls.showCenterNodes ||
			controls.showInsertedPoints;
	}

	private renderMeshOverlay(mesh: any, insertedPoints: Array<{ x: number; y: number }>, overlay: MeshOverlay): void
	{
		overlay.polygonGraph.clear();
		overlay.dualGraph.clear();
		overlay.cornerNodes.clear();
		overlay.centerNodes.clear();
		overlay.insertedNodes.clear();

		const polygonGraph = overlay.polygonGraph;
		mesh.edges.forEach((edge: any) =>
		{
			const vertexA = mesh.vertices[edge.vertices[0]].point;
			const vertexB = mesh.vertices[edge.vertices[1]].point;
			polygonGraph.moveTo(vertexA.x, vertexA.y);
			polygonGraph.lineTo(vertexB.x, vertexB.y);
		});
		polygonGraph.stroke({ width: 1.3, color: 0xff4d4f, alpha: 0.75 });

		const dualGraph = overlay.dualGraph;
		mesh.edges.forEach((edge: any) =>
		{
			const [faceA, faceB] = edge.faces;
			if (faceA < 0 || faceB < 0)
			{
				return;
			}
			const a = mesh.faces[faceA].point;
			const b = mesh.faces[faceB].point;
			dualGraph.moveTo(a.x, a.y);
			dualGraph.lineTo(b.x, b.y);
		});
		dualGraph.stroke({ width: 0.9, color: 0x4da3ff, alpha: 0.8 });

		const cornerNodes = overlay.cornerNodes;
		mesh.vertices.forEach((vertex: any) =>
		{
			cornerNodes.circle(vertex.point.x, vertex.point.y, 1.8);
		});
		cornerNodes.fill({ color: 0xf3fff7, alpha: 0.9 });

		const centerNodes = overlay.centerNodes;
		mesh.faces.forEach((face: any) =>
		{
			centerNodes.circle(face.point.x, face.point.y, 2.3);
		});
		centerNodes.fill({ color: 0xff00c9, alpha: 0.95 });

		const insertedNodes = overlay.insertedNodes;
		for (let i = 0; i < insertedPoints.length; i += 1)
		{
			const point = insertedPoints[i];
			insertedNodes.circle(point.x, point.y, 2.2);
		}
		insertedNodes.fill({ color: 0xffe56b, alpha: 0.9 });
	}
}
