import type { BluetoothErrorCode, BluetoothPermissionStatus } from "../types";

export type MeshSessionState = "idle" | "handshaking" | "open" | "failed";

export type MeshEvictionPolicy = "oldest" | "largest";

export type MeshHandshakeMode = "noise-psk-sim";

export interface MeshNodeConfig {
  nodeId: string;
  localName?: string;
  serviceUuid: string;
  characteristicUuid: string;
  scanNamePrefix?: string;
  allowDuplicates?: boolean;
  connectable?: boolean;
  ttl?: number;
  autoStartScan?: boolean;
}

export interface MeshNodeState {
  running: boolean;
  nodeId: string;
  localName: string | null;
  serviceUuid: string | null;
  characteristicUuid: string | null;
  peers: number;
  sessionsOpen: number;
  relayQueueDepth: number;
}

export interface MeshPeer {
  peerId: string;
  deviceId: string;
  name: string | null;
  rssi: number | null;
  lastSeen: number;
  sessionState: MeshSessionState;
  connected: boolean;
  connectionId: string | null;
}

export interface MeshMessage {
  id: string;
  senderId: string;
  recipientId: string | null;
  roomId: string | null;
  payloadBase64: string;
  timestamp: number;
}

export interface MeshRelayEnvelope {
  protoVersion: number;
  flags: number;
  messageId: string;
  originId: string;
  recipientId: string | null;
  roomId: string | null;
  ttl: number;
  hopCount: number;
  timestamp: number;
  payloadBase64: string;
  authTagBase64: string | null;
}

export interface MeshRelayPolicy {
  enabled: boolean;
  defaultTtl: number;
  maxTtl: number;
}

export interface MeshStoreForwardPolicy {
  enabled: boolean;
  maxMessages: number;
  maxBytes: number;
  ttlMs: number;
  eviction: MeshEvictionPolicy;
  retryInitialDelayMs: number;
  retryMaxDelayMs: number;
  retryBackoffMultiplier: number;
}

export interface MeshSecurityConfig {
  enabled: boolean;
  handshakeMode: MeshHandshakeMode;
  identityKeyBase64: string;
  rekeyAfterMs: number;
  rekeyAfterMessages: number;
}

export interface MeshSendMessageInput {
  recipientId?: string;
  roomId?: string;
  payloadBase64: string;
  ttl?: number;
}

export interface MeshSession {
  peerId: string;
  createdAt: number;
  lastRekeyAt: number;
  sentCount: number;
  receivedCount: number;
  keyMaterialBase64: string;
  state: MeshSessionState;
}

export interface MeshQueuedEnvelope {
  envelope: MeshRelayEnvelope;
  firstEnqueuedAt: number;
  nextAttemptAt: number;
  retryCount: number;
  bytes: number;
}

export type MeshEvent =
  | {
      type: "node_started" | "node_stopped";
      timestamp: number;
      state: MeshNodeState;
    }
  | {
      type: "peer_discovered" | "peer_lost" | "peer_updated";
      timestamp: number;
      peer: MeshPeer;
    }
  | {
      type: "session_opened" | "session_failed" | "session_closed";
      timestamp: number;
      peerId: string;
      reason?: string;
    }
  | {
      type: "message_received" | "message_relayed" | "message_dropped";
      timestamp: number;
      envelope: MeshRelayEnvelope;
      reason?: string;
    }
  | {
      type: "queue_enqueued" | "queue_expired" | "queue_evicted";
      timestamp: number;
      envelope: MeshRelayEnvelope;
      queueDepth: number;
    }
  | {
      type: "security_handshake_started" | "security_handshake_succeeded" | "security_handshake_failed";
      timestamp: number;
      peerId: string;
      reason?: string;
    }
  | {
      type: "error";
      timestamp: number;
      code: BluetoothErrorCode;
      message: string;
    };

export interface MeshListenerSubscription {
  remove(): void;
}

export interface MeshRuntimeContext {
  nodeId: string;
  relayPolicy: MeshRelayPolicy;
  nowMs(): number;
}

export interface MeshTransportRecord {
  peerId: string;
  connectionId: string;
  serviceUuid: string;
  characteristicUuid: string;
}

export interface MeshStartResult {
  state: MeshNodeState;
  permissions: BluetoothPermissionStatus;
}
