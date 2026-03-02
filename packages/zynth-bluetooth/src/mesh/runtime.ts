import { BluetoothBLE } from "../BluetoothBLE";
import type { BluetoothBleEvent } from "../types";
import { emitDevtoolsEvent } from "@zynth/core";
import { base64ToBytes, bytesToBase64, decodeEnvelope, dedupeKey, encodeEnvelope, normalizeUuid, createEnvelopeBase } from "./protocol";
import { forwardedEnvelope, getRelayDecision } from "./router";
import { MeshSecurityEngine } from "./security";
import { StoreForwardQueue } from "./storeForward";
import type {
  MeshEvent,
  MeshListenerSubscription,
  MeshMessage,
  MeshNodeConfig,
  MeshNodeState,
  MeshPeer,
  MeshRelayEnvelope,
  MeshRelayPolicy,
  MeshSecurityConfig,
  MeshSession,
  MeshStartResult,
  MeshStoreForwardPolicy,
  MeshTransportRecord,
} from "./types";

interface PeerRecord {
  peer: MeshPeer;
  transport: MeshTransportRecord | null;
  lastRssiEmitAt: number;
  lastEmittedRssi: number | null;
}

interface PendingPacketAssembly {
  total: number;
  parts: Map<number, Uint8Array>;
  createdAt: number;
  sourceId: string;
}

class DedupeCache {
  private readonly cache = new Map<string, number>();

  constructor(private readonly maxSize: number) {}

  public has(key: string): boolean {
    return this.cache.has(key);
  }

  public put(key: string, timestamp: number): void {
    this.cache.set(key, timestamp);
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (typeof firstKey === "string") {
        this.cache.delete(firstKey);
      }
    }
  }
}

function defaultRelayPolicy(): MeshRelayPolicy {
  return {
    enabled: true,
    defaultTtl: 3,
    maxTtl: 8,
  };
}

function defaultStoreForwardPolicy(): MeshStoreForwardPolicy {
  return {
    enabled: true,
    maxMessages: 256,
    maxBytes: 512 * 1024,
    ttlMs: 120000,
    eviction: "oldest",
    retryInitialDelayMs: 500,
    retryMaxDelayMs: 8000,
    retryBackoffMultiplier: 1.8,
  };
}

function defaultSecurityConfig(): MeshSecurityConfig {
  const identitySeed = new TextEncoder().encode("zynth-mesh-dev-identity-v1");
  const keyBase64 = bytesToBase64(identitySeed);

  return {
    // Default off until peer identity/session binding is finalized across platforms.
    enabled: false,
    handshakeMode: "noise-psk-sim",
    identityKeyBase64: keyBase64,
    rekeyAfterMs: 10 * 60 * 1000,
    rekeyAfterMessages: 1024,
  };
}

export class MeshRuntime {
  private readonly listeners = new Set<(event: MeshEvent) => void>();
  private readonly peers = new Map<string, PeerRecord>();
  private readonly sessions = new Map<string, MeshSession>();
  private readonly dedupe = new DedupeCache(4096);
  private readonly pendingAssemblies = new Map<string, PendingPacketAssembly>();
  private readonly peerWriteChains = new Map<string, Promise<boolean>>();
  private readonly peerNoResponseSupport = new Map<string, boolean>();
  private readonly peerTransportRetryAfterMs = new Map<string, number>();

  private relayPolicy = defaultRelayPolicy();
  private storeForwardPolicy = defaultStoreForwardPolicy();
  private securityConfig = defaultSecurityConfig();

  private securityEngine = new MeshSecurityEngine(this.securityConfig);
  private storeForwardQueue = new StoreForwardQueue(this.storeForwardPolicy);

  private bleSubscription: MeshListenerSubscription | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private nodeConfig: MeshNodeConfig | null = null;
  private running = false;

  private static readonly FRAME_BINARY_PREFIX = 0x43; // 'C'
  private static readonly FRAME_BINARY_HEADER_BYTES = 4; // prefix + messageKey + index + total
  private static readonly FRAME_MAX_BYTES = 20; // conservative BLE write payload target
  private static readonly FRAME_PAYLOAD_BYTES = MeshRuntime.FRAME_MAX_BYTES - MeshRuntime.FRAME_BINARY_HEADER_BYTES;
  private static readonly ASSEMBLY_TTL_MS = 20000;
  private static readonly WRITE_WITH_RESPONSE_TIMEOUT_MS = 2500;
  private static readonly WRITE_NO_RESPONSE_TIMEOUT_MS = 1500;
  private static readonly TRANSPORT_RETRY_COOLDOWN_MS = 5000;

  public addListener(listener: (event: MeshEvent) => void): MeshListenerSubscription {
    this.listeners.add(listener);
    return {
      remove: () => {
        this.listeners.delete(listener);
      },
    };
  }

  public setRelayPolicy(policy: Partial<MeshRelayPolicy>): MeshRelayPolicy {
    this.relayPolicy = {
      enabled: policy.enabled ?? this.relayPolicy.enabled,
      defaultTtl: Math.max(1, Math.min(12, Math.round(policy.defaultTtl ?? this.relayPolicy.defaultTtl))),
      maxTtl: Math.max(1, Math.min(16, Math.round(policy.maxTtl ?? this.relayPolicy.maxTtl))),
    };
    if (this.relayPolicy.defaultTtl > this.relayPolicy.maxTtl) {
      this.relayPolicy.defaultTtl = this.relayPolicy.maxTtl;
    }
    return this.relayPolicy;
  }

  public setStoreForwardPolicy(policy: Partial<MeshStoreForwardPolicy>): MeshStoreForwardPolicy {
    this.storeForwardPolicy = {
      enabled: policy.enabled ?? this.storeForwardPolicy.enabled,
      maxMessages: Math.max(8, Math.round(policy.maxMessages ?? this.storeForwardPolicy.maxMessages)),
      maxBytes: Math.max(64 * 1024, Math.round(policy.maxBytes ?? this.storeForwardPolicy.maxBytes)),
      ttlMs: Math.max(5000, Math.round(policy.ttlMs ?? this.storeForwardPolicy.ttlMs)),
      eviction: policy.eviction ?? this.storeForwardPolicy.eviction,
      retryInitialDelayMs: Math.max(50, Math.round(policy.retryInitialDelayMs ?? this.storeForwardPolicy.retryInitialDelayMs)),
      retryMaxDelayMs: Math.max(200, Math.round(policy.retryMaxDelayMs ?? this.storeForwardPolicy.retryMaxDelayMs)),
      retryBackoffMultiplier: Math.max(1.1, policy.retryBackoffMultiplier ?? this.storeForwardPolicy.retryBackoffMultiplier),
    };
    this.storeForwardQueue.updatePolicy(this.storeForwardPolicy);
    return this.storeForwardPolicy;
  }

  public setSecurityConfig(config: Partial<MeshSecurityConfig>): MeshSecurityConfig {
    this.securityConfig = {
      enabled: config.enabled ?? this.securityConfig.enabled,
      handshakeMode: config.handshakeMode ?? this.securityConfig.handshakeMode,
      identityKeyBase64: config.identityKeyBase64 ?? this.securityConfig.identityKeyBase64,
      rekeyAfterMs: Math.max(30000, Math.round(config.rekeyAfterMs ?? this.securityConfig.rekeyAfterMs)),
      rekeyAfterMessages: Math.max(64, Math.round(config.rekeyAfterMessages ?? this.securityConfig.rekeyAfterMessages)),
    };
    this.securityEngine.updateConfig(this.securityConfig);
    return this.securityConfig;
  }

  public async start(config: MeshNodeConfig): Promise<MeshStartResult> {
    if (this.running) {
      return {
        state: this.getNodeState(),
        permissions: await BluetoothBLE.getPermissionsAsync(),
      };
    }

    this.nodeConfig = {
      ...config,
      serviceUuid: normalizeUuid(config.serviceUuid),
      characteristicUuid: normalizeUuid(config.characteristicUuid),
      ttl: Math.max(1, Math.round(config.ttl ?? this.relayPolicy.defaultTtl)),
      autoStartScan: config.autoStartScan !== false,
      connectable: config.connectable !== false,
      allowDuplicates: config.allowDuplicates === true,
    };

    const permissions = await BluetoothBLE.requestPermissionsAsync("all");
    if (!permissions.allGranted) {
      throw new Error(
        `Mesh start failed: Bluetooth permissions are not granted (scan=${String(permissions.bluetoothScan)} connect=${String(permissions.bluetoothConnect)} advertise=${String(permissions.bluetoothAdvertise)})`
      );
    }
    const supported = BluetoothBLE.isSupported();
    if (!supported) {
      throw new Error("Bluetooth mesh is unsupported on this runtime");
    }

    if (BluetoothBLE.isPeripheralSupported()) {
      await BluetoothBLE.startPeripheralAsync({
        localName: this.nodeConfig.localName ?? this.nodeConfig.nodeId,
        serviceUuid: this.nodeConfig.serviceUuid,
        characteristicUuid: this.nodeConfig.characteristicUuid,
        connectable: this.nodeConfig.connectable,
      });
    }

    if (this.nodeConfig.autoStartScan) {
      await BluetoothBLE.startScanAsync({
        allowDuplicates: this.nodeConfig.allowDuplicates,
        namePrefix: this.nodeConfig.scanNamePrefix,
        serviceUuids: [this.nodeConfig.serviceUuid],
      });
    }

    this.bleSubscription = BluetoothBLE.addListener((event) => {
      void this.onBleEvent(event);
    });

    this.flushTimer = setInterval(() => {
      void this.flushQueue();
    }, 400);

    this.running = true;
    this.emit({
      type: "node_started",
      timestamp: Date.now(),
      state: this.getNodeState(),
    });

    return {
      state: this.getNodeState(),
      permissions,
    };
  }

  public async stop(): Promise<boolean> {
    if (!this.running) {
      return true;
    }

    this.running = false;
    if (this.flushTimer != null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.bleSubscription != null) {
      this.bleSubscription.remove();
      this.bleSubscription = null;
    }

    await BluetoothBLE.stopScanAsync();
    await BluetoothBLE.stopPeripheralAsync();

    const connections = await BluetoothBLE.getConnectionsAsync();
    for (const connection of connections) {
      await BluetoothBLE.disconnectAsync(connection.connectionId);
    }

    this.emit({
      type: "node_stopped",
      timestamp: Date.now(),
      state: this.getNodeState(),
    });

    return true;
  }

  public getPeers(): ReadonlyArray<MeshPeer> {
    return [...this.peers.values()].map((entry) => entry.peer);
  }

  public getNodeState(): MeshNodeState {
    let sessionsOpen = 0;
    for (const session of this.sessions.values()) {
      if (session.state === "open") {
        sessionsOpen += 1;
      }
    }

    return {
      running: this.running,
      nodeId: this.nodeConfig?.nodeId ?? "",
      localName: this.nodeConfig?.localName ?? null,
      serviceUuid: this.nodeConfig?.serviceUuid ?? null,
      characteristicUuid: this.nodeConfig?.characteristicUuid ?? null,
      peers: this.peers.size,
      sessionsOpen,
      relayQueueDepth: this.storeForwardQueue.depth(),
    };
  }

  public async sendMessage(input: {
    recipientId?: string;
    roomId?: string;
    payloadBase64: string;
    ttl?: number;
  }): Promise<MeshMessage> {
    if (!this.running || this.nodeConfig == null) {
      throw new Error("Mesh node is not running");
    }

    const timestamp = Date.now();
    const envelope = createEnvelopeBase(
      this.nodeConfig.nodeId,
      input.payloadBase64,
      timestamp,
      Math.max(1, Math.round(input.ttl ?? this.nodeConfig.ttl ?? this.relayPolicy.defaultTtl)),
      input.recipientId,
      input.roomId
    );

    await this.dispatchEnvelope(envelope, true);

    return {
      id: envelope.messageId,
      senderId: envelope.originId,
      recipientId: envelope.recipientId,
      roomId: envelope.roomId,
      payloadBase64: envelope.payloadBase64,
      timestamp: envelope.timestamp,
    };
  }

  private emit(event: MeshEvent): void {
    emitDevtoolsEvent({
      topic: `mesh/${event.type.replace(/_/g, "/")}`,
      level: event.type === "error" ? "error" : "info",
      tag: "mesh",
      data: event,
    });
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private async onBleEvent(event: BluetoothBleEvent): Promise<void> {
    if (!this.running || this.nodeConfig == null) {
      return;
    }

    if (event.type === "scan_result") {
      // Use a stable identity to avoid peer rows "blinking" when advertised names fluctuate.
      const peerId = event.device.id;
      const now = Date.now();
      const existing = this.peers.get(peerId);
      const nextRssi = typeof event.device.rssi === "number" ? event.device.rssi : null;
      const peer: MeshPeer = {
        peerId,
        deviceId: event.device.id,
        name: event.device.name,
        rssi: nextRssi,
        lastSeen: now,
        sessionState: existing?.peer.sessionState ?? "idle",
        connected: existing?.peer.connected ?? false,
        connectionId: existing?.peer.connectionId ?? null,
      };
      const lastRssiEmitAt = existing?.lastRssiEmitAt ?? 0;
      const lastEmittedRssi = existing?.lastEmittedRssi ?? null;
      this.peers.set(peerId, {
        peer,
        transport: existing?.transport ?? null,
        lastRssiEmitAt,
        lastEmittedRssi,
      });

      if (existing == null) {
        this.emit({
          type: "peer_discovered",
          timestamp: now,
          peer,
        });
        const record = this.peers.get(peerId);
        if (record != null) {
          record.lastRssiEmitAt = now;
          record.lastEmittedRssi = nextRssi;
          this.peers.set(peerId, record);
        }
        return;
      }

      const nameChanged = existing.peer.name !== peer.name;
      const rssiChangedEnough =
        nextRssi != null &&
        (lastEmittedRssi == null || Math.abs(nextRssi - lastEmittedRssi) >= 3);
      const rssiEmitIntervalElapsed = now - lastRssiEmitAt >= 1500;

      if (nameChanged || (rssiChangedEnough && rssiEmitIntervalElapsed)) {
        this.emit({
          type: "peer_updated",
          timestamp: now,
          peer,
        });
        const record = this.peers.get(peerId);
        if (record != null) {
          record.lastRssiEmitAt = now;
          record.lastEmittedRssi = nextRssi;
          this.peers.set(peerId, record);
        }
      }
      return;
    }

    if (event.type === "connection_state") {
      const peer = this.findPeerByDeviceId(event.connection.deviceId);
      const now = Date.now();
      if (peer == null) {
        const discovered: MeshPeer = {
          peerId: event.connection.deviceId,
          deviceId: event.connection.deviceId,
          name: event.connection.name,
          rssi: null,
          lastSeen: now,
          sessionState: "idle",
          connected: event.connection.connected,
          connectionId: event.connection.connected ? event.connection.connectionId : null,
        };
        const transport: MeshTransportRecord | null = event.connection.connected
          ? {
              peerId: discovered.peerId,
              connectionId: event.connection.connectionId,
              serviceUuid: this.nodeConfig.serviceUuid,
              characteristicUuid: this.nodeConfig.characteristicUuid,
            }
          : null;
        this.peers.set(discovered.peerId, {
          peer: discovered,
          transport,
          lastRssiEmitAt: now,
          lastEmittedRssi: null,
        });
        this.emit({
          type: "peer_discovered",
          timestamp: now,
          peer: discovered,
        });
        return;
      }

      const updated: MeshPeer = {
        ...peer.peer,
        connected: event.connection.connected,
        connectionId: event.connection.connected ? event.connection.connectionId : null,
        sessionState: event.connection.connected ? peer.peer.sessionState : "idle",
      };

      const transport: MeshTransportRecord | null = event.connection.connected
        ? {
            peerId: updated.peerId,
            connectionId: event.connection.connectionId,
            serviceUuid: this.nodeConfig.serviceUuid,
            characteristicUuid: this.nodeConfig.characteristicUuid,
          }
        : null;

      this.peers.set(updated.peerId, {
        peer: updated,
        transport,
        lastRssiEmitAt: peer.lastRssiEmitAt,
        lastEmittedRssi: peer.lastEmittedRssi,
      });
      this.emit({
        type: "peer_updated",
        timestamp: now,
        peer: updated,
      });
      return;
    }

    if (event.type === "characteristic_changed") {
      const sourceId = event.connectionId;
      await this.handleIncomingFrame(event.dataBase64, sourceId);
      return;
    }

    if (event.type === "peripheral_characteristic_write") {
      const sourceId = event.centralId;
      await this.handleIncomingFrame(event.dataBase64, sourceId);
      return;
    }

    if (event.type === "error") {
      this.emit({
        type: "error",
        timestamp: event.timestamp,
        code: event.code,
        message: event.message,
      });
    }
  }

  private async handleIncomingFrame(frameDataBase64: string, sourceId: string): Promise<void> {
    this.cleanupAssemblies();

    const rawBytes = base64ToBytes(frameDataBase64);
    if (rawBytes.byteLength >= MeshRuntime.FRAME_BINARY_HEADER_BYTES && rawBytes[0] === MeshRuntime.FRAME_BINARY_PREFIX) {
      const messageKey = rawBytes[1];
      const index = rawBytes[2];
      const total = rawBytes[3];
      if (total <= 0 || index >= total) {
        return;
      }

      const payload = rawBytes.slice(MeshRuntime.FRAME_BINARY_HEADER_BYTES);
      const key = `${sourceId}:${String(messageKey)}`;
      const existing = this.pendingAssemblies.get(key);
      const assembly: PendingPacketAssembly = existing ?? {
        total,
        parts: new Map<number, Uint8Array>(),
        createdAt: Date.now(),
        sourceId,
      };
      if (assembly.total !== total) {
        this.pendingAssemblies.delete(key);
        this.emit({
          type: "error",
          timestamp: Date.now(),
          code: "E_NATIVE",
          message: `Frame total mismatch for source ${sourceId} key ${messageKey}: existing=${assembly.total} incoming=${total}`,
        });
        return;
      }
      assembly.parts.set(index, payload);
      this.pendingAssemblies.set(key, assembly);

      if (assembly.parts.size < assembly.total) {
        return;
      }

      let totalBytes = 0;
      for (let i = 0; i < assembly.total; i += 1) {
        const part = assembly.parts.get(i);
        if (part == null) {
          return;
        }
        totalBytes += part.byteLength;
      }

      const all = new Uint8Array(totalBytes);
      let offset = 0;
      for (let i = 0; i < assembly.total; i += 1) {
        const part = assembly.parts.get(i);
        if (part == null) {
          return;
        }
        all.set(part, offset);
        offset += part.byteLength;
      }

      this.pendingAssemblies.delete(key);
      const packetBase64 = new TextDecoder().decode(all);
      await this.handleIncomingPacket(packetBase64, sourceId);
      return;
    }

    // Backward compatibility with old raw packet writes.
    await this.handleIncomingPacket(frameDataBase64, sourceId);
  }

  private cleanupAssemblies(): void {
    const now = Date.now();
    const entries = [...this.pendingAssemblies.entries()];
    for (const entry of entries) {
      const key = entry[0];
      const value = entry[1];
      if (now - value.createdAt > MeshRuntime.ASSEMBLY_TTL_MS) {
        this.pendingAssemblies.delete(key);
        this.emit({
          type: "error",
          timestamp: now,
          code: "E_NATIVE",
          message: `Frame assembly timed out for source ${value.sourceId} key=${key} receivedParts=${value.parts.size}/${value.total}`,
        });
      }
    }
  }

  private async handleIncomingPacket(packetBase64: string, sourceId?: string): Promise<void> {
    if (this.nodeConfig == null) {
      return;
    }

    let envelope: MeshRelayEnvelope;
    try {
      envelope = decodeEnvelope(packetBase64);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid packet";
      this.emit({
        type: "error",
        timestamp: Date.now(),
        code: "E_NATIVE",
        message,
      });
      return;
    }

    const decision = getRelayDecision(
      envelope,
      {
        nodeId: this.nodeConfig.nodeId,
        relayPolicy: this.relayPolicy,
        nowMs: () => Date.now(),
      },
      this.dedupe,
      this.relayPolicy,
      this.directPeerIds()
    );

    if (!decision.shouldProcess) {
      this.emit({
        type: "message_dropped",
        timestamp: Date.now(),
        envelope,
        reason: decision.reason,
      });
      return;
    }

    let decryptedEnvelope = envelope;
    if (this.securityConfig.enabled && envelope.originId !== this.nodeConfig.nodeId) {
      const session = await this.ensureSession(envelope.originId);
      if (session.state !== "open") {
        this.emit({
          type: "session_failed",
          timestamp: Date.now(),
          peerId: envelope.originId,
          reason: "session_not_open",
        });
        return;
      }

      try {
        decryptedEnvelope = await this.securityEngine.decryptEnvelope(session, envelope);
      } catch (error) {
        this.emit({
          type: "security_handshake_failed",
          timestamp: Date.now(),
          peerId: envelope.originId,
          reason: error instanceof Error ? error.message : "decrypt_failed",
        });
        return;
      }

      session.receivedCount += 1;
      this.sessions.set(session.peerId, session);
    }

    if (decision.shouldDeliverToApp) {
      this.emit({
        type: "message_received",
        timestamp: Date.now(),
        envelope: decryptedEnvelope,
      });
    }

    if (decision.shouldRelay) {
      const forwarded = forwardedEnvelope(envelope, this.relayPolicy);
      if (forwarded != null) {
        const excludedPeerIds = new Set<string>();
        const sourcePeerId = sourceId == null ? null : this.resolvePeerIdFromSource(sourceId);
        if (sourcePeerId != null) {
          excludedPeerIds.add(sourcePeerId);
        }
        const relayTargets = forwarded.recipientId != null
          ? (excludedPeerIds.has(forwarded.recipientId) ? [] : [forwarded.recipientId])
          : this.candidatePeerIds(false, excludedPeerIds);
        if (relayTargets.length === 0) {
          this.emit({
            type: "message_dropped",
            timestamp: Date.now(),
            envelope: forwarded,
            reason: "no_relay_targets",
          });
          return;
        }
        await this.dispatchEnvelope(forwarded, false, excludedPeerIds);
        this.emit({
          type: "message_relayed",
          timestamp: Date.now(),
          envelope: forwarded,
        });
      }
    }
  }

  private async dispatchEnvelope(
    envelope: MeshRelayEnvelope,
    includeOrigin: boolean,
    excludedPeerIds?: ReadonlySet<string>
  ): Promise<void> {
    if (this.nodeConfig == null) {
      return;
    }

    let toSend = envelope;
    if (this.securityConfig.enabled) {
      const recipients = envelope.recipientId != null
        ? [envelope.recipientId]
        : this.candidatePeerIds(includeOrigin, excludedPeerIds);
      if (recipients.length === 1) {
        const session = await this.ensureSession(recipients[0]);
        if (session.state === "open") {
          if (this.securityEngine.shouldRekey(session, Date.now())) {
            this.sessions.set(session.peerId, await this.securityEngine.rekeySession(this.nodeConfig.nodeId, session, Date.now()));
          }
          const live = this.sessions.get(recipients[0]);
          if (live != null) {
            toSend = await this.securityEngine.encryptEnvelope(live, envelope);
            live.sentCount += 1;
          }
        }
      }
    }

    const packet = encodeEnvelope(toSend);
    const frames = this.encodeTransportFrames(packet, toSend.messageId);
    let targets = envelope.recipientId != null
      ? [envelope.recipientId]
      : this.candidatePeerIds(includeOrigin, excludedPeerIds);
    if (targets.length === 0) {
      await this.refreshPeersFromScan();
      targets = envelope.recipientId != null
        ? [envelope.recipientId]
        : this.candidatePeerIds(includeOrigin, excludedPeerIds);
    }

    if (targets.length === 0) {
      const result = this.storeForwardQueue.enqueue(toSend, Date.now());
      if (result.enqueued) {
        this.emit({
          type: "queue_enqueued",
          timestamp: Date.now(),
          envelope: toSend,
          queueDepth: this.storeForwardQueue.depth(),
        });
      }
      return;
    }

    for (const peerId of targets) {
      const success = await this.writeToPeer(peerId, frames);
      if (!success) {
        const result = this.storeForwardQueue.enqueue(toSend, Date.now());
        if (result.enqueued) {
          this.emit({
            type: "queue_enqueued",
            timestamp: Date.now(),
            envelope: toSend,
            queueDepth: this.storeForwardQueue.depth(),
          });
        }
      }
    }
  }

  private async refreshPeersFromScan(): Promise<void> {
    const scanned = await BluetoothBLE.getScannedDevicesAsync();
    const now = Date.now();
    for (const device of scanned) {
      const peerId = device.id;
      if (this.peers.has(peerId)) {
        continue;
      }
      const peer: MeshPeer = {
        peerId,
        deviceId: device.id,
        name: device.name,
        rssi: typeof device.rssi === "number" ? device.rssi : null,
        lastSeen: now,
        sessionState: "idle",
        connected: false,
        connectionId: null,
      };
      this.peers.set(peerId, {
        peer,
        transport: null,
        lastRssiEmitAt: now,
        lastEmittedRssi: peer.rssi,
      });
      this.emit({
        type: "peer_discovered",
        timestamp: now,
        peer,
      });
    }
  }

  private async flushQueue(): Promise<void> {
    if (!this.running || this.nodeConfig == null) {
      return;
    }

    const tick = this.storeForwardQueue.tick(Date.now());

    for (const item of tick.expired) {
      this.emit({
        type: "queue_expired",
        timestamp: Date.now(),
        envelope: item.envelope,
        queueDepth: this.storeForwardQueue.depth(),
      });
    }

    for (const item of tick.ready) {
      const packet = encodeEnvelope(item.envelope);
      const frames = this.encodeTransportFrames(packet, item.envelope.messageId);
      const targets = item.envelope.recipientId != null ? [item.envelope.recipientId] : this.candidatePeerIds(true);
      let delivered = false;
      for (const peerId of targets) {
        if (await this.writeToPeer(peerId, frames)) {
          delivered = true;
          break;
        }
      }

      if (delivered) {
        this.storeForwardQueue.remove(item);
      } else {
        this.storeForwardQueue.markAttemptFailed(item, Date.now());
      }
    }
  }

  private encodeTransportFrames(packetBase64: string, messageId: string): string[] {
    const packetBytes = new TextEncoder().encode(packetBase64);
    const total = Math.ceil(packetBytes.byteLength / MeshRuntime.FRAME_PAYLOAD_BYTES);
    if (total > 255) {
      throw new Error("E_PROTOCOL_PACKET_TOO_LARGE");
    }
    const messageKey = this.messageKey(messageId);
    const frames: string[] = [];
    for (let index = 0; index < total; index += 1) {
      const start = index * MeshRuntime.FRAME_PAYLOAD_BYTES;
      const chunk = packetBytes.slice(start, start + MeshRuntime.FRAME_PAYLOAD_BYTES);
      const frame = new Uint8Array(MeshRuntime.FRAME_BINARY_HEADER_BYTES + chunk.byteLength);
      frame[0] = MeshRuntime.FRAME_BINARY_PREFIX;
      frame[1] = messageKey;
      frame[2] = index & 0xff;
      frame[3] = total & 0xff;
      frame.set(chunk, MeshRuntime.FRAME_BINARY_HEADER_BYTES);
      frames.push(bytesToBase64(frame));
    }
    return frames;
  }

  private messageKey(messageId: string): number {
    let hash = 0;
    for (let i = 0; i < messageId.length; i += 1) {
      hash = (hash + messageId.charCodeAt(i)) & 0xff;
    }
    return hash;
  }

  private async writeToPeer(peerId: string, framePayloadsBase64: ReadonlyArray<string>): Promise<boolean> {
    const previous = this.peerWriteChains.get(peerId) ?? Promise.resolve(true);
    const current = previous
      .catch(() => false)
      .then(async () => this.writeToPeerInternal(peerId, framePayloadsBase64));
    this.peerWriteChains.set(peerId, current);
    try {
      return await current;
    } finally {
      if (this.peerWriteChains.get(peerId) === current) {
        this.peerWriteChains.delete(peerId);
      }
    }
  }

  private async writeToPeerInternal(peerId: string, framePayloadsBase64: ReadonlyArray<string>): Promise<boolean> {
    if (this.nodeConfig == null) {
      return false;
    }

    const record = this.peers.get(peerId);
    if (record == null) {
      return false;
    }

    const retryAfterMs = this.peerTransportRetryAfterMs.get(peerId) ?? 0;
    if (Date.now() < retryAfterMs) {
      return false;
    }

    let transport = record.transport;
    if (transport == null || !record.peer.connected || record.peer.connectionId == null) {
      transport = await this.ensureTransport(peerId, record.peer.deviceId);
      if (transport == null) {
        this.peerTransportRetryAfterMs.set(peerId, Date.now() + MeshRuntime.TRANSPORT_RETRY_COOLDOWN_MS);
        return false;
      }
      this.peers.set(peerId, {
        peer: {
          ...record.peer,
          connected: true,
          connectionId: transport.connectionId,
        },
        transport,
        lastRssiEmitAt: record.lastRssiEmitAt,
        lastEmittedRssi: record.lastEmittedRssi,
      });
      const updated = this.peers.get(peerId);
      if (updated != null) {
        this.emit({
          type: "peer_updated",
          timestamp: Date.now(),
          peer: updated.peer,
        });
      }
    }

    for (const payload of framePayloadsBase64) {
      const sent = await this.writeFrameWithFallback(transport, payload, peerId);
      if (!sent) {
        return false;
      }
    }
    return true;
  }

  private async writeFrameWithFallback(
    transport: MeshTransportRecord,
    payloadBase64: string,
    peerId: string
  ): Promise<boolean> {
    try {
      await BluetoothBLE.writeCharacteristicAsync({
        connectionId: transport.connectionId,
        serviceUuid: transport.serviceUuid,
        characteristicUuid: transport.characteristicUuid,
        dataBase64: payloadBase64,
        withResponse: true,
        timeoutMs: MeshRuntime.WRITE_WITH_RESPONSE_TIMEOUT_MS,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const lower = message.toLowerCase();
      if (lower.includes("timed out") || lower.includes("timeout")) {
        await this.resetPeerTransport(peerId);
        this.peerTransportRetryAfterMs.set(peerId, Date.now() + MeshRuntime.TRANSPORT_RETRY_COOLDOWN_MS);
        this.emit({
          type: "error",
          timestamp: Date.now(),
          code: "E_NATIVE",
          message: `Write with response timed out for peer ${peerId}; transport reset: ${message}`,
        });
        return false;
      }
      this.emit({
        type: "error",
        timestamp: Date.now(),
        code: "E_NATIVE",
        message: `Write with response failed for peer ${peerId}, retrying without response: ${message}`,
      });
    }

    const noResponseSupported = this.peerNoResponseSupport.get(peerId) ?? true;
    if (!noResponseSupported) {
      return false;
    }

    try {
      await BluetoothBLE.writeCharacteristicAsync({
        connectionId: transport.connectionId,
        serviceUuid: transport.serviceUuid,
        characteristicUuid: transport.characteristicUuid,
        dataBase64: payloadBase64,
        withResponse: false,
        timeoutMs: MeshRuntime.WRITE_NO_RESPONSE_TIMEOUT_MS,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message.toLowerCase().includes("does not support write without response")) {
        this.peerNoResponseSupport.set(peerId, false);
      }
      this.emit({
        type: "error",
        timestamp: Date.now(),
        code: "E_NATIVE",
        message: `Write without response failed for peer ${peerId}: ${message}`,
      });
      return false;
    }
  }

  private async resetPeerTransport(peerId: string): Promise<void> {
    const record = this.peers.get(peerId);
    if (record == null) {
      return;
    }
    const connectionId = record.transport?.connectionId ?? record.peer.connectionId;
    this.peers.set(peerId, {
      peer: {
        ...record.peer,
        connected: false,
        connectionId: null,
      },
      transport: null,
      lastRssiEmitAt: record.lastRssiEmitAt,
      lastEmittedRssi: record.lastEmittedRssi,
    });
    const updated = this.peers.get(peerId);
    if (updated != null) {
      this.emit({
        type: "peer_updated",
        timestamp: Date.now(),
        peer: updated.peer,
      });
    }
    if (connectionId != null) {
      try {
        await BluetoothBLE.disconnectAsync(connectionId);
      } catch {
        // best effort transport reset
      }
    }
  }

  private async ensureTransport(peerId: string, deviceId: string): Promise<MeshTransportRecord | null> {
    if (this.nodeConfig == null) {
      return null;
    }

    let connectionId: string | null = null;
    try {
      const connection = await BluetoothBLE.connectAsync({
        deviceId,
        timeoutMs: 12000,
      });
      connectionId = connection.connectionId;
    } catch (error) {
      this.emit({
        type: "error",
        timestamp: Date.now(),
        code: "E_NATIVE",
        message: `Transport setup failed for peer ${peerId} at connect (deviceId=${deviceId}): ${error instanceof Error ? error.message : "unknown"}`,
      });
      return null;
    }

    try {
      await BluetoothBLE.discoverServicesAsync(connectionId, 10000);
    } catch (error) {
      this.emit({
        type: "error",
        timestamp: Date.now(),
        code: "E_NATIVE",
        message: `Transport setup failed for peer ${peerId} at service discovery (connectionId=${connectionId}): ${error instanceof Error ? error.message : "unknown"}`,
      });
      return null;
    }

    // Notifications are useful for receive path, but they should not block write transport setup.
    // Some peripheral stacks can accept writes while CCCD/notify setup fails.
    try {
      await BluetoothBLE.setNotificationAsync({
        connectionId,
        serviceUuid: this.nodeConfig.serviceUuid,
        characteristicUuid: this.nodeConfig.characteristicUuid,
        enabled: true,
        timeoutMs: 10000,
      });
    } catch (error) {
      this.emit({
        type: "error",
        timestamp: Date.now(),
        code: "E_NATIVE",
        message: `Transport setup notify failed for peer ${peerId} (connectionId=${connectionId}); continuing writable transport: ${error instanceof Error ? error.message : "unknown"}`,
      });
    }

    return {
      peerId,
      connectionId,
      serviceUuid: this.nodeConfig.serviceUuid,
      characteristicUuid: this.nodeConfig.characteristicUuid,
    };
  }

  private async ensureSession(peerId: string): Promise<MeshSession> {
    if (this.nodeConfig == null) {
      throw new Error("Mesh node is not running");
    }

    const existing = this.sessions.get(peerId);
    if (existing != null && existing.state === "open") {
      return existing;
    }

    this.emit({
      type: "security_handshake_started",
      timestamp: Date.now(),
      peerId,
    });

    try {
      const session = await this.securityEngine.openSession(this.nodeConfig.nodeId, peerId, Date.now());
      this.sessions.set(peerId, session);
      this.emit({
        type: "security_handshake_succeeded",
        timestamp: Date.now(),
        peerId,
      });
      this.emit({
        type: "session_opened",
        timestamp: Date.now(),
        peerId,
      });
      return session;
    } catch (error) {
      const session: MeshSession = {
        peerId,
        createdAt: Date.now(),
        lastRekeyAt: Date.now(),
        sentCount: 0,
        receivedCount: 0,
        keyMaterialBase64: "",
        state: "failed",
      };
      this.sessions.set(peerId, session);
      this.emit({
        type: "security_handshake_failed",
        timestamp: Date.now(),
        peerId,
        reason: error instanceof Error ? error.message : "handshake_failed",
      });
      return session;
    }
  }

  private findPeerByDeviceId(deviceId: string): PeerRecord | null {
    for (const entry of this.peers.values()) {
      if (entry.peer.deviceId === deviceId) {
        return entry;
      }
    }
    return null;
  }

  private candidatePeerIds(includeOrigin: boolean, excludedPeerIds?: ReadonlySet<string>): string[] {
    const peers: string[] = [];
    for (const entry of this.peers.values()) {
      if (!includeOrigin && this.nodeConfig != null && entry.peer.peerId === this.nodeConfig.nodeId) {
        continue;
      }
      if (excludedPeerIds?.has(entry.peer.peerId)) {
        continue;
      }
      peers.push(entry.peer.peerId);
    }
    return peers;
  }

  private resolvePeerIdFromSource(sourceId: string): string | null {
    for (const entry of this.peers.values()) {
      if (
        entry.peer.peerId === sourceId ||
        entry.peer.deviceId === sourceId ||
        entry.peer.connectionId === sourceId
      ) {
        return entry.peer.peerId;
      }
    }
    return null;
  }

  private directPeerIds(): Set<string> {
    const direct = new Set<string>();
    for (const entry of this.peers.values()) {
      if (entry.peer.connected) {
        direct.add(entry.peer.peerId);
      }
    }
    return direct;
  }

  public stopAndReset(): void {
    this.running = false;
    if (this.flushTimer != null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.bleSubscription != null) {
      this.bleSubscription.remove();
      this.bleSubscription = null;
    }
    this.peers.clear();
    this.sessions.clear();
    this.nodeConfig = null;
  }
}
