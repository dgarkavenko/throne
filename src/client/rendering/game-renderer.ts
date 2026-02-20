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
	TerrainStaticRenderModel,
} from './terrain-presentation';
import { Vec2 } from '../../terrain/core/math';

class OverlayContainer {

	container: Container;
	selectioin: Graphics;
	debug: Graphics;

	constructor()
	{
		this.container = new Container();
		this.selectioin = new Graphics();
		this.debug = new Graphics();
		this.container.addChild(this.debug, this.selectioin);
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
	private lastTerrainState: TerrainGenerationState | null = null;
	private lastMapWidth = 0;
	private lastMapHeight = 0;
	private terrainStaticRenderModel: TerrainStaticRenderModel | null = null;

	private renderControls: TerrainRenderControls = { ...DEFAULT_TERRAIN_RENDER_CONTROLS };
	private debugControlsDirty: boolean = true;

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
		this.debugControlsDirty =
			fingerprintTerrainRenderControls(prev) !== fingerprintTerrainRenderControls(sanitized);
		const refinementChanged = hasRefinementControlChange(prev, sanitized);
		this.renderControls = sanitized;
		if (refinementChanged)
		{
			this.refinementCache.clear();
		}

		return { changed: this.debugControlsDirty, refinementChanged };
	}

	renderTerrainOnce(
		mapWidth: number,
		mapHeight: number,
		terrainState: TerrainGenerationState
	): void
	{
		this.lastTerrainState = terrainState;
		this.lastMapWidth = mapWidth;
		this.lastMapHeight = mapHeight;
		const refined = this.refinementCache.resolve(terrainState, this.renderControls);
		this.terrainStaticRenderModel = buildTerrainPresentationState(
			{ width: mapWidth, height: mapHeight },
			terrainState,
			this.renderControls,
			refined
		); 
		const staticRender = this.terrainStaticRenderModel;
		const passControls = toTerrainRenderPassControls(this.renderControls, terrainState);
	
		renderTerrain(
			staticRender.config,
			passControls,
			this.terrainLayer,
			staticRender.base,
			staticRender.provinces,
			staticRender.refined
		);
	}

	rerenderProvinceBorders(): void
	{
		if (!this.lastTerrainState)
		{
			return;
		}
		const terrainState = this.lastTerrainState;
		const refined = this.refinementCache.resolve(terrainState, this.renderControls);
		this.terrainStaticRenderModel = buildTerrainPresentationState(
			{ width: this.lastMapWidth, height: this.lastMapHeight },
			terrainState,
			this.renderControls,
			refined
		);
		updateProvinceBorders(this.terrainLayer, toTerrainBorderControls(this.renderControls));
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

		const hoverWidth = 1.0;
		const selectedWidth = 2.1;

		this.terrainOveraly.selectioin.clear();

		for (let entity of query(game.world, [ProvinceComponent, Hovered]))
		{
			this.drawProvinceBorder(entity, this.terrainOveraly.selectioin, 0xdcecff, 0.5, hoverWidth);
		}

		for (let entity of query(game.world, [ProvinceComponent, Selected]))
		{			
			this.drawProvinceBorder(entity, this.terrainOveraly.selectioin, 0xdcecff, 0.5, selectedWidth);			
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
		entity: number,
		graphics: Graphics,
		color: number,
		alpha: number,
		width: number
	): void
	{
		if (this.terrainStaticRenderModel)
		{
			const edgePolylines = this.terrainStaticRenderModel.refined.refinedGeometry.edgePolylines;
			const outerEdges = this.terrainStaticRenderModel.provinces.outerEdges;

			//Outer edges shall be real edges ID
			//and then =>
			ProvinceComponent.face[entity].outerEdges.forEach((outerEdgeId) =>
			{
				const edgeId = outerEdges[outerEdgeId].edge;
				let edgePolyline = edgePolylines[edgeId];
				graphics.moveTo(edgePolyline[0].x, edgePolyline[0].y);
				for (let i = 1; i < edgePolyline.length; i += 1)
				{
					graphics.lineTo(edgePolyline[i].x, edgePolyline[i].y);
				}
			});
			graphics.stroke({ width, color, alpha });			
		}
		else
		{
			this.drawSimplifiedProvinceBorder(entity, graphics, color, alpha, width);
		}	
	}

	private drawSimplifiedProvinceBorder(entity: number,
		graphics: Graphics,
		color: number,
		alpha: number,
		width: number
	): void
	{
		ProvinceComponent.provinceEdges[entity].forEach((segment) =>
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

	public renderDebug(terrain: TerrainGenerationState | null)
	{
		if (terrain && this.debugControlsDirty)
		{
			this.terrainOveraly.debug.clear();
			this.renderDebug_internal(
				this.terrainOveraly.debug,
				this.renderControls,
				terrain
			);

			this.debugControlsDirty = false;
		}
	}

	private renderDebug_internal(
		target: Graphics,
		controls: TerrainRenderControls,
		terrainState: TerrainGenerationState,
		//insertedPoints: Array<{ x: number; y: number }>,
	): void
	{
		const mesh = terrainState.mesh;

		if (controls.showPolygonGraph)
		{
			mesh.edges.forEach((edge: any) =>
			{
				const vertexA = mesh.vertices[edge.vertices[0]].point;
				const vertexB = mesh.vertices[edge.vertices[1]].point;
				target.moveTo(vertexA.x, vertexA.y);
				target.lineTo(vertexB.x, vertexB.y);
			});
			target.stroke({ width: 1.3, color: 0xff4d4f, alpha: 0.75 });
		}

		if (controls.showDualGraph)
		{
			mesh.edges.forEach((edge: any) =>
			{
				const [faceA, faceB] = edge.faces;
				if (faceA < 0 || faceB < 0)
				{
					return;
				}
				const a = mesh.faces[faceA].point;
				const b = mesh.faces[faceB].point;
				target.moveTo(a.x, a.y);
				target.lineTo(b.x, b.y);
			});
			target.stroke({ width: 0.9, color: 0x4da3ff, alpha: 0.8 });
		}

		if (controls.showCornerNodes)
		{
			mesh.vertices.forEach((vertex: any) =>
			{
				target.circle(vertex.point.x, vertex.point.y, 1.8);
			});
			target.fill({ color: 0xf3fff7, alpha: 0.9 });
		}

		if (controls.showCenterNodes)
		{
			mesh.faces.forEach((face: any) =>
			{
				target.circle(face.point.x, face.point.y, 2.3);
			});
			target.fill({ color: 0xff00c9, alpha: 0.95 });
		}
		
		if (controls.showInsertedPoints && this.terrainStaticRenderModel)
		{
			const edgePolylines = this.terrainStaticRenderModel.refined.refinedGeometry.edgePolylines;
			const outerEdges = this.terrainStaticRenderModel.provinces.outerEdges;

			outerEdges.forEach((outerEdge) =>
			{
				let edgePolyline = edgePolylines[outerEdge.edge];
				target.moveTo(edgePolyline[0].x, edgePolyline[0].y);
				for (let i = 1; i < edgePolyline.length; i += 1)
				{
					target.lineTo(edgePolyline[i].x, edgePolyline[i].y);
				}
			});
			target.stroke({ width: 0.9, color: 0x4da3ff, alpha: 0.8 });

		}
	}
}
