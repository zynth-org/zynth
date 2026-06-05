import type { HostNode } from "./host/HostTypes";
import { getActiveSurface, setActiveSurface } from "./surface";

export interface PortalSurfaceRoot extends HostNode {
  type: "root";
}

export interface PortalSurfaceHandle {
  surfaceId: number;
  root: PortalSurfaceRoot;
  run<T>(work: () => T): T;
}

/**
 * Creates a JS handle for a native-owned portal surface.
 *
 * Native owns allocation, attachment, sizing, and disposal. Solid renderers use
 * this handle to route host operations into the surface synchronously.
 */
export function createPortalSurfaceHandle(surfaceId: number): PortalSurfaceHandle {
  const root: PortalSurfaceRoot = { id: surfaceId, type: "root" };

  return {
    surfaceId,
    root,
    run<T>(work: () => T): T {
      const previous = getActiveSurface();
      const shouldSwitch = previous !== surfaceId;
      if (shouldSwitch) setActiveSurface(surfaceId);
      try {
        return work();
      } finally {
        if (shouldSwitch) setActiveSurface(previous);
      }
    },
  };
}
