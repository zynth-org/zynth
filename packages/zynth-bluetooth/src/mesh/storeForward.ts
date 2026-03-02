import type { MeshQueuedEnvelope, MeshRelayEnvelope, MeshStoreForwardPolicy } from "./types";

export interface StoreForwardTickResult {
  ready: MeshQueuedEnvelope[];
  expired: MeshQueuedEnvelope[];
  evicted: MeshQueuedEnvelope[];
}

export class StoreForwardQueue {
  private queue: MeshQueuedEnvelope[] = [];
  private totalBytes = 0;

  constructor(private policy: MeshStoreForwardPolicy) {}

  public updatePolicy(policy: MeshStoreForwardPolicy): void {
    this.policy = policy;
    this.prune(Date.now());
  }

  public depth(): number {
    return this.queue.length;
  }

  public enqueue(envelope: MeshRelayEnvelope, nowMs: number): { enqueued: boolean; evicted: MeshQueuedEnvelope[] } {
    if (!this.policy.enabled) {
      return { enqueued: false, evicted: [] };
    }

    const bytes = Math.max(1, envelope.payloadBase64.length);
    const entry: MeshQueuedEnvelope = {
      envelope,
      firstEnqueuedAt: nowMs,
      nextAttemptAt: nowMs,
      retryCount: 0,
      bytes,
    };

    this.queue.push(entry);
    this.totalBytes += bytes;
    const evicted = this.prune(nowMs);
    const stillPresent = this.queue.includes(entry);
    return { enqueued: stillPresent, evicted };
  }

  public markAttemptFailed(entry: MeshQueuedEnvelope, nowMs: number): void {
    entry.retryCount += 1;
    const multiplier = Math.pow(this.policy.retryBackoffMultiplier, entry.retryCount);
    const delay = Math.min(
      this.policy.retryMaxDelayMs,
      Math.max(this.policy.retryInitialDelayMs, Math.round(this.policy.retryInitialDelayMs * multiplier))
    );
    entry.nextAttemptAt = nowMs + delay;
  }

  public remove(entry: MeshQueuedEnvelope): void {
    const index = this.queue.indexOf(entry);
    if (index >= 0) {
      this.totalBytes -= this.queue[index].bytes;
      this.queue.splice(index, 1);
    }
  }

  public tick(nowMs: number): StoreForwardTickResult {
    const expired: MeshQueuedEnvelope[] = [];
    for (const item of this.queue) {
      const age = nowMs - item.firstEnqueuedAt;
      if (age > this.policy.ttlMs) {
        expired.push(item);
      }
    }

    for (const item of expired) {
      this.remove(item);
    }

    const ready = this.queue.filter((item) => item.nextAttemptAt <= nowMs);
    return {
      ready,
      expired,
      evicted: [],
    };
  }

  private prune(nowMs: number): MeshQueuedEnvelope[] {
    const evicted: MeshQueuedEnvelope[] = [];

    const expired = this.queue.filter((item) => nowMs - item.firstEnqueuedAt > this.policy.ttlMs);
    for (const item of expired) {
      this.remove(item);
      evicted.push(item);
    }

    while (this.queue.length > this.policy.maxMessages || this.totalBytes > this.policy.maxBytes) {
      const victim = this.selectVictim();
      if (!victim) {
        break;
      }
      this.remove(victim);
      evicted.push(victim);
    }

    return evicted;
  }

  private selectVictim(): MeshQueuedEnvelope | null {
    if (this.queue.length === 0) {
      return null;
    }

    if (this.policy.eviction === "largest") {
      let largest = this.queue[0];
      for (const item of this.queue) {
        if (item.bytes > largest.bytes) {
          largest = item;
        }
      }
      return largest;
    }

    let oldest = this.queue[0];
    for (const item of this.queue) {
      if (item.firstEnqueuedAt < oldest.firstEnqueuedAt) {
        oldest = item;
      }
    }
    return oldest;
  }
}
