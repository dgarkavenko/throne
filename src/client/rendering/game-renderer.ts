import { observe, onAdd, onRemove, query } from 'bitecs';
import { Assets, Application, Container, Graphics, Sprite } from 'pixi.js';
import
	{
		ActorComponent,
		Dirty,
		Hovered,
		ProvinceComponent,
		RenderableComponent,
		Selected,
	} from '../../ecs/components';
import type { EcsGame } from '../../ecs/game';
import { renderTerrain, updateProvinceBorders } from '../../terrain/core/terrain-core';
import type { TerrainGenerationState } from '../../terrain/types';
import {
	DEFAULT_TERRAIN_RENDER_CONTROLS,
	fingerprintTerrainRenderControls,
	hasRefinementControlChange,
	normalizeTerrainRenderControls,
	toTerrainBorderControls,
	toTerrainRenderPassControls,
	type TerrainRenderControls,
} from './render-controls';
import { TerrainRefinementCacheStore } from './refinement-cache';
import {
	buildTerrainPresentationState,
	type TerrainPresentationState,
	type Vec2,
} from './terrain-presentation';

type MeshOverlay = {
	container: Container;
	polygonGraph: Graphics;
	dualGraph: Graphics;
	cornerNodes: Graphics;
	centerNodes: Graphics;
	insertedNodes: Graphics;
};

class OverlayContainer {

	container: Container;
	graphics: Graphics;

	constructor()
	{
		this.container = new Container();
		this.graphics = new Graphics();
		this.container.addChild(this.graphics);
	}
};

export class GameRenderer
{
	public readonly app: Application;

	public readonly terrainLayer: Container = new Container();
	public readonly terrainOveraly: OverlayContainer = new OverlayContainer();
	public readonly unitsLayer: Container = new Container();
	public readonly uiLayer: Container = new Container();

	private readonly sprites = new Map<number, Sprite>();
	private canvasHandlers = new Map<string, EventListener>();
	private readonly refinementCache = new TerrainRefinementCacheStore();
	private renderControls: TerrainRenderControls = { ...DEFAULT_TERRAIN_RENDER_CONTROLS };
	private lastTerrainState: TerrainGenerationState | null = null;
	private lastMapWidth = 0;
	private lastMapHeight = 0;
	private terrainState: TerrainPresentationState | null = null;
	private meshOverlay: MeshOverlay | null = null;

	constructor()
	{
		this.app = new Application();
	}

	async init(w: number, h: number, ratio: number, field: HTMLElement | null): Promise<void>
	{
		await this.app.init({
			width: w,
			height: h,
			resolution: ratio,
			autoDensity: true,
			backgroundAlpha: 0,
			antialias: true,
		});

		if (field)
		{
			field.appendChild(this.app.canvas ?? this.app.view);
		}

		this.app.stage.addChild(this.terrainLayer, this.terrainOveraly.container, this.unitsLayer, this.uiLayer);
	}

	async hookGame(game: EcsGame): Promise<void>
	{
		await Assets.load([
			{ alias: 'unit_cb_02', src: '/assets/units/unit_cb_02.png' },
			{ alias: 'unit_cav_02', src: '/assets/units/unit_cav_01.png' },
			{ alias: 'unit_levy_01', src: '/assets/units/unit_levy_01.png' },
		]);

		observe(game.world, onAdd(Dirty), (eid) =>
		{
			const alias = RenderableComponent.content[eid];
			if (!alias)
			{
				console.warn('Renderable added but sprite alias missing', { eid });
				return;
			}

			const spr = Sprite.from(alias);
			spr.anchor.set(0.5);
			spr.position.set(RenderableComponent.x[eid] ?? 0, RenderableComponent.y[eid] ?? 0);
			spr.tint = RenderableComponent.color[eid] ?? 0xffffff;

			this.unitsLayer.addChild(spr);
			this.sprites.set(eid, spr);
		});

		observe(game.world, onRemove(RenderableComponent), (eid) =>
		{
			const spr = this.sprites.get(eid);
			if (spr)
			{
				spr.destroy();
				this.sprites.delete(eid);
			}
		});
	}

	setTerrainRenderControls(next: TerrainRenderControls): {
		changed: boolean;
		refinementChanged: boolean;
	}
	{
		const sanitized = normalizeTerrainRenderControls(next);
		const prev = this.renderControls;
		const changed =
			fingerprintTerrainRenderControls(prev) !== fingerprintTerrainRenderControls(sanitized);
		const refinementChanged = hasRefinementControlChange(prev, sanitized);
		this.renderControls = sanitized;
		if (refinementChanged)
		{
			this.refinementCache.clear();
		}
		return { changed, refinementChanged };
	}

	renderTerrain(
		mapWidth: number,
		mapHeight: number,
		terrainState: TerrainGenerationState
	): void
	{
		this.lastTerrainState = terrainState;
		this.lastMapWidth = mapWidth;
		this.lastMapHeight = mapHeight;
		const refined = this.refinementCache.resolve(terrainState, this.renderControls);
		this.terrainState = buildTerrainPresentationState(
			{ width: mapWidth, height: mapHeight },
			terrainState,
			this.renderControls,
			refined
		); 
		const staticRender = this.terrainState.staticRender;
		const passControls = toTerrainRenderPassControls(this.renderControls, terrainState);
		renderTerrain(
			staticRender.config,
			passControls,
			this.terrainLayer,
			staticRender.base,
			staticRender.provinces,
			staticRender.refined
		);
		const overlay = this.ensureMeshOverlay();
		this.renderMeshOverlay(
			staticRender.base.mesh,
			staticRender.refined.refinedGeometry.insertedPoints,
			overlay
		);
		this.setGraphOverlayVisibility();
	}

	rerenderProvinceBorders(): void
	{
		if (!this.lastTerrainState)
		{
			return;
		}
		const terrainState = this.lastTerrainState;
		const refined = this.refinementCache.resolve(terrainState, this.renderControls);
		this.terrainState = buildTerrainPresentationState(
			{ width: this.lastMapWidth, height: this.lastMapHeight },
			terrainState,
			this.renderControls,
			refined
		);
		updateProvinceBorders(this.terrainLayer, toTerrainBorderControls(this.renderControls));
		this.setGraphOverlayVisibility();
	}

	renderView(game: EcsGame): void
	{

		for (const eid of query(game.world, [RenderableComponent]))
		{
			const spr = this.sprites.get(eid);
			if (spr)
			{
				spr.position.set(RenderableComponent.x[eid] ?? 0, RenderableComponent.y[eid] ?? 0);
				spr.tint = RenderableComponent.color[eid] ?? 0xffffff;
			}
		}

		const hoveredActors = query(game.world, [ActorComponent, RenderableComponent, Hovered]);
		for (const eid of hoveredActors)
		{
			const spr = this.sprites.get(eid);
			if (spr)
			{
				spr.tint = 0xff0000;
			}
		}

		const selectedActors = query(game.world, [ActorComponent, RenderableComponent, Selected]);
		for (const eid of selectedActors)
		{
			const spr = this.sprites.get(eid);
			if (spr)
			{
				spr.tint = 0x000000;
			}
		}
		
		this.terrainOveraly.graphics.clear();

		const hoverWidth = 1.0;
		const selectedWidth = 2.1;

		for (let entity of query(game.world, [ProvinceComponent, Hovered]))
		{
			this.drawProvinceBorder(ProvinceComponent.provinceId[entity], this.terrainOveraly.graphics, 0xdcecff, 0.5, hoverWidth);
		}

		for (let entity of query(game.world, [ProvinceComponent, Selected]))
		{			
			this.drawProvinceBorder(ProvinceComponent.provinceId[entity], this.terrainOveraly.graphics, 0xdcecff, 0.5, selectedWidth);			
		}
	}

	bindCanvasEvent(type: string, handler: (ev: any) => void): void
	{
		const canvas = this.app.canvas;

		const prev = this.canvasHandlers.get(type);
		if (prev)
		{
			canvas.removeEventListener(type, prev);
		}

		canvas.addEventListener(type, handler);
		this.canvasHandlers.set(type, handler);
	}

	private drawProvinceBorder(
		provinceId: number,
		graphics: Graphics,
		color: number,
		alpha: number,
		width: number
	): void
	{
		if (!this.terrainState)
			return;

		const segments = this.terrainState.overlay.provinceBorderPaths[provinceId];

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

	private ensureMeshOverlay(): MeshOverlay
	{
		if (this.meshOverlay)
		{
			this.terrainLayer.setChildIndex(this.meshOverlay.container, this.terrainLayer.children.length - 1);
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
		this.terrainLayer.addChild(container);
		this.meshOverlay = { container, polygonGraph, dualGraph, cornerNodes, centerNodes, insertedNodes };
		return this.meshOverlay;
	}

	private setGraphOverlayVisibility(): void
	{
		if (!this.meshOverlay || !this.terrainState)
		{
			return;
		}
		const controls = this.terrainState.staticRender.renderControls;
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

	private renderMeshOverlay(
		mesh: any,
		insertedPoints: Array<{ x: number; y: number }>,
		overlay: MeshOverlay
	): void
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

		const overlayInsertedNodes = overlay.insertedNodes;
		for (let i = 0; i < insertedPoints.length; i += 1)
		{
			const point = insertedPoints[i];
			overlayInsertedNodes.circle(point.x, point.y, 2.2);
		}
		overlayInsertedNodes.fill({ color: 0xffe56b, alpha: 0.9 });
	}
}
