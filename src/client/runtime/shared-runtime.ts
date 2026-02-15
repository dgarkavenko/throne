/**
 * Shared browser runtime used by both game and editor modes.
 * Key runtime branches:
 * - terrain generation apply/regenerate flow (full or dirty-stage partial)
 * - world snapshot acceptance gates (terrain version + sequence monotonicity)
 * - pointer interaction branch for actor selection vs province selection
 */
import { observe, onSet, setComponent } from 'bitecs';
import { Container, Graphics } from 'pixi.js';
import
	{
		createClientPipeline,
		createEcsGame,
		ensureActorEntity,
		removeActorEntity,
		type EcsPipeline,
		type TGame,
	} from '../../ecs/game';
import { ActorComponent, RenderableComponent, TerrainLocationComponent } from '../../ecs/components';
import { TRenderer } from '../../ecs/renderer';
import type { TerrainGenerationControls } from '../../terrain/controls';
import type { TerrainGenerationDirtyFlags, TerrainGenerationState } from '../../terrain/types';
import { MapSystem } from '../../terrain/runtime/map-system';
import { TerrainRenderer } from '../terrain/renderer';
import { DEFAULT_TERRAIN_RENDER_CONTROLS, type TerrainRenderControls } from '../terrain/render-controls';
import type { ActorSnapshot, TerrainSnapshot, WorldSnapshotMessage } from '../../shared/protocol';

export type GameConfig = {
	width: number;
	height: number;
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

export class SharedGameRuntime
{
	protected readonly config: GameConfig;
	protected terrainState: TerrainGenerationState | null = null;
	private provinceInteractionModel: ProvinceInteractionModel | null = null;
	private provinceInteractionOverlay: ProvinceInteractionOverlay | null = null;
	private hoveredProvinceId: number | null = null;
	private selectedProvinceId: number | null = null;
	private selectionListeners = new Set<(provinceId: number | null) => void>();

	protected localPlayerId: number | null = null;
	private selectedActorId: number | null = null;
	private hoveredActorId: number | null = null;
	protected lastTerrainVersion = 0;
	private actorEntityById = new Map<number, number>();
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

	protected readonly mapSystem: MapSystem;
	protected hasTerrain = false;
	private terrainRenderer: TerrainRenderer | null = null;
	protected readonly r: TRenderer;
	protected readonly game: TGame;
	protected readonly clientPipeline: EcsPipeline;

	constructor(config: GameConfig)
	{
		this.config = config;
		this.mapSystem = new MapSystem({ width: config.width, height: config.height });
		this.r = new TRenderer();
		this.game = createEcsGame();
		this.clientPipeline = createClientPipeline(this.game);
	}

	async init(field: HTMLElement | null): Promise<void>
	{
		await this.r.init(this.config.width, this.config.height, window.devicePixelRatio || 1, field);
		await this.r.hook(this.game);
		this.terrainRenderer = new TerrainRenderer({
			config: { width: this.config.width, height: this.config.height },
			terrainLayer: this.r.terrainLayer,
		});

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

		this.r.app.ticker.add
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
		const terrainRenderer = this.terrainRenderer;
		if (!terrainRenderer)
		{
			return;
		}
		const result = terrainRenderer.setRenderControls(nextControls);
		if (!this.hasTerrain || !this.terrainState || !result.changed)
		{
			return;
		}
		if (result.refinementChanged)
		{
			this.renderTerrainState(this.terrainState);
		} else
		{
			terrainRenderer.rerenderProvinceBorders(this.mapSystem.getGenerationControls());
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

	bind(onFrame?: (deltaMs: number, now: number) => void): void
	{

	}

	setLocalPlayerId(playerId: number | null): void
	{
		this.localPlayerId = playerId;
		if (this.selectedActorId !== null && this.getActorOwner(this.selectedActorId) !== this.localPlayerId)
		{
			this.selectedActorId = null;
		}
	}

	getTerrainVersion(): number
	{
		return this.lastTerrainVersion;
	}

	onProvinceSelectionChange(listener: (provinceId: number | null) => void): () => void
	{
		this.selectionListeners.add(listener);
		return () =>
		{
			this.selectionListeners.delete(listener);
		};
	}

	protected setTerrainGenerationControlsInternal(
		nextControls: TerrainGenerationControls,
		regenerateIfMissing: boolean
	): void
	{
		const result = this.mapSystem.setTerrainGenerationControls(nextControls);
		if (!this.hasTerrain)
		{
			if (regenerateIfMissing)
			{
				this.regenerateTerrain();
			}
			return;
		}
		if (result.changed)
		{
			this.regenerateTerrainPartial(result.dirty);
			return;
		}
		if (this.terrainState)
		{
			this.renderTerrainState(this.terrainState);
		}
	}

	protected applyTerrainSnapshotInternal(snapshot: TerrainSnapshot, terrainVersion: number): void
	{
		this.lastTerrainVersion = Math.max(0, Math.round(terrainVersion));
		this.lastWorldSnapshotSeq = -1;
		this.setTerrainGenerationControlsInternal(snapshot.controls, true);
	}

	protected getTerrainSnapshotForReplicationInternal(): TerrainSnapshot
	{
		return {
			controls: this.mapSystem.getGenerationControls(),
			mapWidth: this.config.width,
			mapHeight: this.config.height,
		};
	}

	protected applyWorldSnapshotInternal(
		snapshot: WorldSnapshotMessage,
		throwIfTerrainMissing: boolean
	): void
	{
		if (throwIfTerrainMissing && (!this.navigationGraph || !this.terrainState))
		{
			throw new Error('Received world snapshot before terrain snapshot.');
		}
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
		const liveActorIds = new Set<number>();
		for (let i = 0; i < snapshot.actors.length; i += 1)
		{
			const actorSnapshot = snapshot.actors[i];
			liveActorIds.add(actorSnapshot.actorId);
			const actorEntity = ensureActorEntity(this.game.world, actorSnapshot.actorId, actorSnapshot.ownerId);
			this.actorEntityById.set(actorSnapshot.actorId, actorEntity);
			this.syncUnitFromSnapshot(actorEntity, actorSnapshot, estimatedServerNow, clientReceiveMs);
		}
		const staleActorIds: number[] = [];
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
		if (this.selectedActorId !== null && !this.actorEntityById.has(this.selectedActorId))
		{
			this.selectedActorId = null;
		}
	}

	protected regenerateTerrainPartial(flags: TerrainGenerationDirtyFlags): void
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

	protected regenerateTerrain(): void
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

	protected renderTerrainState(state: TerrainGenerationState): void
	{
		if (!this.terrainRenderer)
		{
			return;
		}
		this.terrainRenderer.render(state, this.mapSystem.getGenerationControls());
		this.renderProvinceInteractionOverlay();
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
		if (hoveredActorId !== null)
		{
			this.setHoveredProvince(null);
			return;
		}
		const nextHover = this.pickProvinceAt(position.x, position.y);
		this.setHoveredProvince(nextHover);
	};

	private pointerLeave = () =>
	{
		this.hoveredActorId = null;
		this.setHoveredProvince(null);
	};

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
			if (actorId !== null && this.getActorOwner(actorId) === this.localPlayerId)
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
	};

	private contextMenu = (event: MouseEvent) =>
	{
		event.preventDefault();
	};

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
			const overlayContainer = this.terrainRenderer?.getOverlayContainer();
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
		const overlayContainer = this.terrainRenderer?.getOverlayContainer();
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

		const borderWidth = this.terrainRenderer?.getRenderControls().provinceBorderWidth
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

	private pickActorAt(worldX: number, worldY: number): number | null
	{
		let bestId: number | null = null;
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

	private setSelectedActor(actorId: number | null): void
	{
		if (actorId !== null && this.getActorOwner(actorId) !== this.localPlayerId)
		{
			return;
		}
		if (this.selectedActorId === actorId)
		{
			return;
		}
		this.selectedActorId = actorId;
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

	private removeReplicatedActor(actorId: number): void
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
		_estimatedServerNow: number,
		_clientReceiveMs: number
	): void
	{
		setComponent(this.game.world, eid, TerrainLocationComponent, { faceId: snapshot.currentFace });
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

	private getActorOwner(actorId: number): number | null
	{
		const eid = this.actorEntityById.get(actorId);
		if (eid === undefined)
		{
			return null;
		}
		return ActorComponent.ownerId[eid] ?? null;
	}
}
