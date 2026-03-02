import { dedupeKey } from "./protocol";
import type { MeshRelayEnvelope, MeshRelayPolicy, MeshRuntimeContext } from "./types";

export interface RelayDecision {
  shouldProcess: boolean;
  shouldDeliverToApp: boolean;
  shouldRelay: boolean;
  reason?: string;
}

export interface DedupeCache {
  has(key: string): boolean;
  put(key: string, atMs: number): void;
}

export function getRelayDecision(
  envelope: MeshRelayEnvelope,
  context: MeshRuntimeContext,
  dedupe: DedupeCache,
  relayPolicy: MeshRelayPolicy,
  directPeers: ReadonlySet<string>
): RelayDecision {
  if (envelope.protoVersion !== 1) {
    return {
      shouldProcess: false,
      shouldDeliverToApp: false,
      shouldRelay: false,
      reason: "unsupported_version",
    };
  }

  const key = dedupeKey(envelope);
  if (dedupe.has(key)) {
    return {
      shouldProcess: false,
      shouldDeliverToApp: false,
      shouldRelay: false,
      reason: "duplicate",
    };
  }
  dedupe.put(key, context.nowMs());

  const isForMe = envelope.recipientId == null || envelope.recipientId === context.nodeId;
  const shouldRelay =
    relayPolicy.enabled &&
    envelope.originId !== context.nodeId &&
    envelope.ttl > 0 &&
    envelope.hopCount < relayPolicy.maxTtl &&
    (envelope.recipientId == null || !directPeers.has(envelope.recipientId));

  return {
    shouldProcess: true,
    shouldDeliverToApp: isForMe,
    shouldRelay,
  };
}

export function forwardedEnvelope(
  envelope: MeshRelayEnvelope,
  relayPolicy: MeshRelayPolicy
): MeshRelayEnvelope | null {
  if (!relayPolicy.enabled || envelope.ttl <= 0) {
    return null;
  }

  const nextHop = envelope.hopCount + 1;
  const nextTtl = envelope.ttl - 1;
  if (nextTtl <= 0 || nextHop > relayPolicy.maxTtl) {
    return null;
  }

  return {
    ...envelope,
    hopCount: nextHop,
    ttl: nextTtl,
  };
}
