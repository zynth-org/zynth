let activeSurfaceId = 0;

export function setActiveSurface(id: number) {
  if (typeof id !== "number" || Number.isNaN(id)) return;
  activeSurfaceId = id;

  const g = globalThis as Record<string, any>;
  const ui = g.__ui;
  if (ui && typeof ui.setSurface === "function") {
    try {
      ui.setSurface(id);
    } catch (error) {
      console.error("[ZynthSurface] Failed to set surface", error);
    }
  }
}

export function getActiveSurface(): number {
  return activeSurfaceId;
}
