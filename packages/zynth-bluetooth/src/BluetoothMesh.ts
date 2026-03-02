import { BluetoothBLE } from "./BluetoothBLE";
import type { BluetoothEventSubscription, BluetoothPermissionStatus } from "./types";
import { MeshRuntime } from "./mesh/runtime";
import type {
  MeshEvent,
  MeshListenerSubscription,
  MeshMessage,
  MeshNodeConfig,
  MeshNodeState,
  MeshPeer,
  MeshRelayPolicy,
  MeshSecurityConfig,
  MeshSendMessageInput,
  MeshStartResult,
  MeshStoreForwardPolicy,
} from "./mesh/types";

const runtime = new MeshRuntime();

export const BluetoothMesh = {
  isSupported(): boolean {
    return BluetoothBLE.isSupported();
  },

  async getPermissionsAsync(): Promise<BluetoothPermissionStatus> {
    return BluetoothBLE.getPermissionsAsync("all");
  },

  async requestPermissionsAsync(): Promise<BluetoothPermissionStatus> {
    return BluetoothBLE.requestPermissionsAsync("all");
  },

  async startNodeAsync(config: MeshNodeConfig): Promise<MeshStartResult> {
    return runtime.start(config);
  },

  async stopNodeAsync(): Promise<boolean> {
    return runtime.stop();
  },

  async getNodeStateAsync(): Promise<MeshNodeState> {
    return runtime.getNodeState();
  },

  async sendMessageAsync(input: MeshSendMessageInput): Promise<MeshMessage> {
    return runtime.sendMessage(input);
  },

  async getPeersAsync(): Promise<ReadonlyArray<MeshPeer>> {
    return runtime.getPeers();
  },

  async setRelayPolicyAsync(policy: Partial<MeshRelayPolicy>): Promise<MeshRelayPolicy> {
    return runtime.setRelayPolicy(policy);
  },

  async setStoreForwardPolicyAsync(policy: Partial<MeshStoreForwardPolicy>): Promise<MeshStoreForwardPolicy> {
    return runtime.setStoreForwardPolicy(policy);
  },

  async setSecurityConfigAsync(config: Partial<MeshSecurityConfig>): Promise<MeshSecurityConfig> {
    return runtime.setSecurityConfig(config);
  },

  addListener(listener: (event: MeshEvent) => void): MeshListenerSubscription {
    return runtime.addListener(listener);
  },

  addBleDebugListener(listener: Parameters<typeof BluetoothBLE.addListener>[0]): BluetoothEventSubscription {
    return BluetoothBLE.addListener(listener);
  },
};
