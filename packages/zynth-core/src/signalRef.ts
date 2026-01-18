import type { HostNode } from "./host/HostTypes";

const SIGNAL_REF_MARKER = "__zynth_signal_ref";

export type SignalRefKind = "node" | "value";

export type SignalRef = {
  [SIGNAL_REF_MARKER]: number;
  __zynth_signal_ref_kind: SignalRefKind;
  valueOf: () => number;
  toString: () => string;
};

type MaybeHostNode = {
  id?: unknown;
};

function resolveSignalRefId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value && typeof value === "object") {
    const node = value as MaybeHostNode;
    if (typeof node.id === "number" && Number.isFinite(node.id)) {
      return node.id;
    }
  }
  return null;
}

export function shareSignalRef(
  value: number | HostNode | null | undefined,
  kind: SignalRefKind = "node"
): SignalRef | null {
  const id = resolveSignalRefId(value);
  if (id === null) return null;
  return {
    [SIGNAL_REF_MARKER]: id,
    __zynth_signal_ref_kind: kind,
    valueOf: () => id,
    toString: () => String(id),
  };
}

export function isSignalRef(value: unknown): value is SignalRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as SignalRef;
  return typeof ref[SIGNAL_REF_MARKER] === "number";
}

export function getSignalRefId(value: unknown): number | null {
  if (!isSignalRef(value)) return null;
  const id = value[SIGNAL_REF_MARKER];
  return Number.isFinite(id) ? id : null;
}
