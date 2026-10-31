import { CheckpointSnapshot } from "./primitives";

/**
 * LIFO 기반 체크포인트 스냅샷 격리 및 롤백 엔진
 */
export class RollbackStack {
  private stack: CheckpointSnapshot[] = [];

  push(checkpointId: string, env: Record<string, any>, pc: number, budget: number): CheckpointSnapshot {
    const snapshot: CheckpointSnapshot = {
      checkpointId,
      envSnapshot: JSON.parse(JSON.stringify(env)), // Deep copy isolation
      retryPc: pc,
      budgetSnapshot: budget,
      timestamp: new Date().toLocaleTimeString(),
    };
    this.stack.push(snapshot);
    return snapshot;
  }

  peek(): CheckpointSnapshot | null {
    if (this.stack.length === 0) return null;
    return this.stack[this.stack.length - 1];
  }

  pop(): CheckpointSnapshot | null {
    return this.stack.pop() || null;
  }

  restoreLatest(): { env: Record<string, any>; pc: number; checkpointId: string } {
    const latest = this.peek();
    if (!latest) {
      throw new Error("Harness Panic: Checkpoint stack is empty. Cannot perform rollback.");
    }
    return {
      env: JSON.parse(JSON.stringify(latest.envSnapshot)),
      pc: latest.retryPc,
      checkpointId: latest.checkpointId,
    };
  }

  getSnapshots(): CheckpointSnapshot[] {
    return [...this.stack];
  }

  clear(): void {
    this.stack = [];
  }

  size(): number {
    return this.stack.length;
  }
}
