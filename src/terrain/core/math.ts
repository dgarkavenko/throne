export type Vec2 = {
	x: number;
	y: number;
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const lerpVec2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
	x: lerp(a.x, b.x, t),
	y: lerp(a.y, b.y, t),
});

export const vec2Sub = (a: Vec2, b: Vec2): Vec2 => ({
	x: a.x - b.x,
	y: a.y - b.y,
});

export const vec2Add = (a: Vec2, b: Vec2): Vec2 => ({
	x: a.x + b.x,
	y: a.y + b.y,
});

export const vec2Mult = (a: Vec2, f: number): Vec2 => ({
	x: a.x * f,
	y: a.y * f,
});

export const vec2LenSq = (v: Vec2): number => v.x * v.x + v.y * v.y;

export const vec2Len = (v: Vec2): number => Math.hypot(v.x, v.y);

export const vec2Dist = (v1: Vec2, v2: Vec2) => {
	const dV = vec2Sub(v1, v2);
	return Math.hypot(dV.x, dV.y);
};

export const vec2Normalize = (v: Vec2): Vec2 => {
	const length = vec2Len(v);
	if (length <= 0) {
		return { x: 0, y: 0 };
	}
	return { x: v.x / length, y: v.y / length };
};

export const vec2Dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

export const vec2Midpoint = (p1: Vec2, p2: Vec2): Vec2 => ({
	x: (p1.x + p2.x) * 0.5,
	y: (p1.y + p2.y) * 0.5,
});

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const smoothstep = (t: number): number => t * t * (3 - 2 * t);
