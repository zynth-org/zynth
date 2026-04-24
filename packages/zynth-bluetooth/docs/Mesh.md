# Bluetooth Mesh

A decentralized mesh networking implementation for Zynth applications, providing peer-to-peer communication over BLE without requiring a central hub.

The `@zynthjs/bluetooth/Mesh` system delivers a multi-hop, reliable, and secure message passing interface. It abstract the complexities of network formation, relaying, and security keys into a high-level `MeshNode` API.

## Basic usage

### Node Initialization

Every participant in the mesh must start its node with a specific configuration (identity, policies, and keys).

```tsx
import { BluetoothMesh } from "@zynthjs/bluetooth";

const startMesh = async () => {
  const result = await BluetoothMesh.startNodeAsync({
    localId: "sensor-node-01",
    displayName: "Kitchen Temperature Sensor",
    serviceUuid: "FFF0",
    characteristicUuid: "FFF1"
  });

  console.log("Mesh Node started:", result.active);
};
```

### Sending Messages

Messages can be sent to all peers (broadcast) or a specific node by its ID.

```tsx
const broadcast = async (temp: number) => {
  const msg = await BluetoothMesh.sendMessageAsync({
    targetId: "*", // Broadcast to all
    payload: JSON.stringify({ type: "event", temp }),
    ttl: 3 // Max hops
  });

  console.log("Message queued in mesh:", msg.id);
};
```

### Receiving Messages

Use the `addListener` method to listen for peer discovery and incoming message events.

```tsx
const listenForData = () => {
  const sub = BluetoothMesh.addListener((event) => {
    switch (event.type) {
      case "message_received":
        console.log("From:", event.senderId, "Data:", event.payload);
        break;
      case "peer_discovered":
        console.log("New peer in mesh:", event.peerId);
        break;
    }
  });

  // subscription.remove() to stop listening
};
```

## Advanced

### Relay and Store-Forward Policies

A mesh node can be configured to act as a **Relay**, extending the network range by forwarding messages from other nodes.

```tsx
await BluetoothMesh.setRelayPolicyAsync({
  enabled: true,
  maxHops: 5,
  minBatteryLevel: 15 // Stop relaying if battery is low
});
```

The **Store-and-Forward** policy informs the node how to handle messages for currently offline peers.

```tsx
await BluetoothMesh.setStoreForwardPolicyAsync({
  maxQueueSize: 100, // Messages to store
  eviction: "fifo"
});
```

### Security Configuration

Control the encryption and signing policies for all incoming and outgoing mesh traffic.

```tsx
await BluetoothMesh.setSecurityConfigAsync({
  encryptionRequired: true,
  signRequired: true,
  sharedSecret: "my-secure-mesh-key"
});
```

## Special cases

- **Underlying Transport**: `BluetoothMesh` operates entirely over BLE. On iOS, it uses `CBPeripheralManager` for advertising and `CBCentralManager` for discovering and connecting to other nodes.
- **TTL (Time To Live)**: Every message has a TTL that indicates how many times it can be relayed (hopped) before being dropped. Each relay decrements this value by 1.
- **Peer Eviction**: Peers that have not signed or advertised for a defined period are automatically removed from the active peer list.

## API Reference

### `BluetoothMesh` Methods

- `startNodeAsync(config: MeshNodeConfig): Promise<MeshStartResult>`
- `stopNodeAsync(): Promise<boolean>`
- `getNodeStateAsync(): Promise<MeshNodeState>`
- `sendMessageAsync(input: MeshSendMessageInput): Promise<MeshMessage>`
- `getPeersAsync(): Promise<ReadonlyArray<MeshPeer>>`
- `setRelayPolicyAsync(policy: Partial<MeshRelayPolicy>): Promise<MeshRelayPolicy>`
- `setStoreForwardPolicyAsync(policy: Partial<MeshStoreForwardPolicy>): Promise<MeshStoreForwardPolicy>`
- `setSecurityConfigAsync(config: Partial<MeshSecurityConfig>): Promise<MeshSecurityConfig>`
