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
import { toLegacyTerrainControls } from '../../terrain/controls';
import type { TerrainPresentationState, Vec2 } from '../terrain/types';

type MeshOverlay = {
	container: Container;
	polygonGraph: Graphics;
	dualGraph: Graphics;
	cornerNodes: Graphics;
	centerNodes: Graphics;
	insertedNodes: Graphics;
};

type ProvinceSelectionOverlay = {
	container: Container;
	hoverGraphics: Graphics;
	selectedGraphics: Graphics;
};

export class GameRenderer
{
	public readonly app: Application;

	public readonly terrainLayer: Container = new Container();
	public readonly unitsLayer: Container = new Container();
	public readonly uiLayer: Container = new Container();

	private readonly sprites = new Map<number, Sprite>();
	private canvasHandlers = new Map<string, EventListener>();
	private terrainState: TerrainPresentationState | null = null;
	private meshOverlay: MeshOverlay | null = null;
	private provinceSelectionOverlay: ProvinceSelectionOverlay | null = null;
	private _width: number;
	private _height: number;

	constructor()
	{
		this.app = new Application();
		this._width = 1;
		this._height = 1;
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

		this._width = 1;
		this._height = 1;

		if (field)
		{
			field.appendChild(this.app.canvas ?? this.app.view);
		}

		this.app.stage.addChild(this.terrainLayer, this.unitsLayer, this.uiLayer);
	}

	async hook(game: EcsGame): Promise<void>
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

	renderTerrainStatic(state: TerrainPresentationState): void
	{
		this.terrainState = state;
		const staticRender = state.staticRender;
		const renderControls = staticRender.renderControls;
		const legacyControls = toLegacyTerrainControls(staticRender.generationControls, {
			showPolygonGraph: renderControls.showPolygonGraph,
			showDualGraph: renderControls.showDualGraph,
			showCornerNodes: renderControls.showCornerNodes,
			showCenterNodes: renderControls.showCenterNodes,
			showInsertedPoints: renderControls.showInsertedPoints,
			provinceBorderWidth: renderControls.provinceBorderWidth,
			showLandBorders: renderControls.showLandBorders,
			showShoreBorders: renderControls.showShoreBorders,
			intermediateSeed: renderControls.intermediateSeed,
			intermediateMaxIterations: renderControls.intermediateMaxIterations,
			intermediateThreshold: renderControls.intermediateThreshold,
			intermediateRelMagnitude: renderControls.intermediateRelMagnitude,
			intermediateAbsMagnitude: renderControls.intermediateAbsMagnitude,
		});
		renderTerrain(
			staticRender.config,
			legacyControls,
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
		this.repositionProvinceOverlay();
	}

	rerenderProvinceBorders(state: TerrainPresentationState): void
	{
		this.terrainState = state;
		const staticRender = state.staticRender;
		const renderControls = staticRender.renderControls;
		const legacyControls = toLegacyTerrainControls(staticRender.generationControls, {
			showPolygonGraph: renderControls.showPolygonGraph,
			showDualGraph: renderControls.showDualGraph,
			showCornerNodes: renderControls.showCornerNodes,
			showCenterNodes: renderControls.showCenterNodes,
			showInsertedPoints: renderControls.showInsertedPoints,
			provinceBorderWidth: renderControls.provinceBorderWidth,
			showLandBorders: renderControls.showLandBorders,
			showShoreBorders: renderControls.showShoreBorders,
			intermediateSeed: renderControls.intermediateSeed,
			intermediateMaxIterations: renderControls.intermediateMaxIterations,
			intermediateThreshold: renderControls.intermediateThreshold,
			intermediateRelMagnitude: renderControls.intermediateRelMagnitude,
			intermediateAbsMagnitude: renderControls.intermediateAbsMagnitude,
		});
		updateProvinceBorders(this.terrainLayer, legacyControls);
		this.setGraphOverlayVisibility();
		this.repositionProvinceOverlay();
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

		this.syncProvinceSelectionOverlay(game);
	}

	syncProvinceSelectionOverlay(game: EcsGame): void
	{
		const overlay = this.ensureProvinceSelectionOverlay();
		overlay.hoverGraphics.clear();
		overlay.selectedGraphics.clear();
		if (!this.terrainState)
		{
			return;
		}

		const borderWidth = this.terrainState.staticRender.renderControls.provinceBorderWidth;
		const hoverWidth = Math.max(1, borderWidth * 0.6);
		const selectedWidth = Math.max(2, borderWidth * 0.95);

		const hoveredProvinces = query(game.world, [ProvinceComponent, Hovered]);
		const selectedProvinces = query(game.world, [ProvinceComponent, Selected]);
		const hoveredProvinceId =
			hoveredProvinces.length > 0 ? ProvinceComponent.provinceId[hoveredProvinces[0]] : null;
		const selectedProvinceId =
			selectedProvinces.length > 0 ? ProvinceComponent.provinceId[selectedProvinces[0]] : null;

		if (hoveredProvinceId !== null && hoveredProvinceId >= 0)
		{
			const segments = this.terrainState.overlay.provinceBorderPaths[hoveredProvinceId];
			if (segments && segments.length > 0)
			{
				this.drawProvinceBorder(overlay.hoverGraphics, segments, 0xdcecff, 0.5, hoverWidth);
			}
		}

		if (selectedProvinceId !== null && selectedProvinceId >= 0)
		{
			const segments = this.terrainState.overlay.provinceBorderPaths[selectedProvinceId];
			if (segments && segments.length > 0)
			{
				this.drawProvinceBorder(overlay.selectedGraphics, segments, 0xffffff, 0.95, selectedWidth);
			}
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
		graphics: Graphics,
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

	private ensureProvinceSelectionOverlay(): ProvinceSelectionOverlay
	{
		if (this.provinceSelectionOverlay)
		{
			this.repositionProvinceOverlay();
			return this.provinceSelectionOverlay;
		}
		const container = new Container();
		const hoverGraphics = new Graphics();
		const selectedGraphics = new Graphics();
		container.addChild(hoverGraphics);
		container.addChild(selectedGraphics);
		this.terrainLayer.addChild(container);
		this.provinceSelectionOverlay = {
			container,
			hoverGraphics,
			selectedGraphics,
		};
		this.repositionProvinceOverlay();
		return this.provinceSelectionOverlay;
	}

	private repositionProvinceOverlay(): void
	{
		if (!this.provinceSelectionOverlay)
		{
			return;
		}

		if (!this.meshOverlay)
		{
			this.terrainLayer.setChildIndex(
				this.provinceSelectionOverlay.container,
				this.terrainLayer.children.length - 1
			);
			return;
		}
		const meshIndex = this.terrainLayer.children.indexOf(this.meshOverlay.container);
		if (meshIndex < 0)
		{
			return;
		}
		const targetIndex = Math.max(0, meshIndex - 1);
		this.terrainLayer.setChildIndex(this.provinceSelectionOverlay.container, targetIndex);
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
