/**
 * 하네스 언어 코어 원자 및 기본 자료형 (Axiom 1 & 2 & 3)
 */

export enum VerdictType {
  PASS = "PASS",
  RETRY = "RETRY",
  FAIL = "FAIL",
}

export interface State {
  text: string;
  confidence: number; // 0.0 ~ 1.0 (토큰 확률 평균)
  entropy: number;    // >= 0.0 (정보 엔트로피)
  rawTokens?: Array<{ token: string; prob: number; entropy: number }>;
}

export interface Feedback {
  guardName: string;
  failedExpr: string;
  directive: string;
  observedMetric: {
    confidence: number;
    entropy: number;
  };
}

export interface CheckpointSnapshot {
  checkpointId: string;
  envSnapshot: Record<string, any>;
  retryPc: number;
  budgetSnapshot: number;
  timestamp: string;
}

export interface ExecutionEvent {
  id: string;
  timestamp: string;
  step: number;
  type: "CHECKPOINT" | "SAMPLING" | "GUARD_EVAL" | "VERDICT" | "ROLLBACK" | "COMMIT" | "INFO";
  title: string;
  description: string;
  metrics?: {
    confidence?: number;
    entropy?: number;
    temperature?: number;
    retryCount?: number;
  };
  verdict?: VerdictType;
  snapshot?: any;
}
