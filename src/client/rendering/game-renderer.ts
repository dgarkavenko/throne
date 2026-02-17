import { observe, onAdd, onRemove, onSet, query } from "bitecs";
import { Assets, Application, Container, Sprite } from "pixi.js";
import { Dirty, RenderableComponent, TerrainLocationComponent } from "../../ecs/components";
import type { EcsGame } from "../../ecs/game";

type Vec2 = { x: number; y: number };

export class GameRenderer
{
	public readonly app: Application;

	public readonly terrainLayer: Container = new Container();
	public readonly unitsLayer: Container = new Container();
	public readonly uiLayer: Container = new Container();

	private readonly sprites = new Map<number, Sprite>();
	private canvasHandlers = new Map<string, EventListener>();
	private _width: number;
	private _height: number;

	constructor()
	{
		this.app = new Application();
		this._width = 1;
		this._height = 1;
	}

	async init(w:number, h:number, ratio:number, field: HTMLElement | null): Promise<void>
	{
		await this.app.init({
			width: w,
			height: h,
			resolution: ratio,
			autoDensity: true,
			backgroundAlpha: 0,
			antialias: true
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
			{ alias: "unit_cb_02", src: "/assets/units/unit_cb_02.png" },
			{ alias: "unit_cav_02", src: "/assets/units/unit_cav_01.png" },
			{ alias: "unit_levy_01", src: "/assets/units/unit_levy_01.png" },
		]);

		observe(game.world, onAdd(Dirty), (eid) =>
		{		
			const alias = RenderableComponent.content[eid];
			if (!alias)
			{
				console.warn("Renderable added but sprite alias missing", { eid });
				return;
			}

			const spr = Sprite.from(alias);
			spr.anchor.set(0.5);

			spr.position.set(RenderableComponent.x[eid] ?? 0, RenderableComponent.y[eid] ?? 0);
			spr.tint = RenderableComponent.color[eid] ?? 0xffffff;

			this.unitsLayer.addChild(spr);
			this.sprites.set(eid, spr);

			console.log("[Renderer] add", { eid, alias});
		});

		observe(game.world, onRemove(RenderableComponent), (eid) =>
		{
			const spr = this.sprites.get(eid);
			if (spr)
			{
				spr.destroy();
				this.sprites.delete(eid);
			}
			console.log("[Renderer] remove", { eid });
		});
	}

	syncView(game: EcsGame): void
	{
		for (const eid of query(game.world, [RenderableComponent]))
		{
			const spr = this.sprites.get(eid);
			if (!spr) continue;

			spr.position.set(RenderableComponent.x[eid] ?? 0, RenderableComponent.y[eid] ?? 0);
			spr.tint = RenderableComponent.color[eid] ?? 0xffffff;
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

};
