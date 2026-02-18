export type PointerSelectionResolution = {
  actorId: number | null;
  provinceId: number | null;
};

export function resolveHoverTarget(
  hoveredActorId: number | null,
  hoveredProvinceId: number | null
): PointerSelectionResolution {
  if (hoveredActorId !== null) {
    return { actorId: hoveredActorId, provinceId: null };
  }
  return { actorId: null, provinceId: hoveredProvinceId };
}

export function resolveSelectionTarget(
  selectedActorId: number | null,
  selectedProvinceId: number | null
): PointerSelectionResolution {
  if (selectedActorId !== null) {
    return { actorId: selectedActorId, provinceId: null };
  }
  return { actorId: null, provinceId: selectedProvinceId };
}

