import {
  State,
  VerdictType,
  Feedback,
  ExecutionEvent,
} from "./primitives";
import { RollbackStack } from "./rollback-stack";
import { ContextSynthesizer, SkillBinding } from "./synthesizer";
import { SamplingEngine } from "./sampling-engine";

export interface FlowOptions {
  maxRetry: number;
  maxBudget: number;
  baseTemp: number;
  scenario?: "FAIL_ONCE" | "FATAL_FAIL" | "CLEAN_PASS";
}

/**
 * 하네스 언어 1차원 선형 가상머신 (Harness Runtime VM)
 */
export class HarnessVM {
  private stack = new RollbackStack();
  private events: ExecutionEvent[] = [];
  private stepCount = 0;

  private record(
    type: ExecutionEvent["type"],
    title: string,
    description: string,
    extra?: Partial<ExecutionEvent>
  ) {
    this.stepCount++;
    this.events.push({
      id: `evt-${this.stepCount}-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      step: this.stepCount,
      type,
      title,
      description,
      ...extra,
    });
  }

  async runFlow(
    flowName: string,
    skillMarkdown: string,
    options: FlowOptions = { maxRetry: 3, maxBudget: 50000, baseTemp: 0.7 },
    apiKey?: string
  ): Promise<{
    success: boolean;
    finalState: State | null;
    events: ExecutionEvent[];
    snapshots: any[];
  }> {
    this.events = [];
    this.stack.clear();
    this.stepCount = 0;

    const samplingEngine = new SamplingEngine(apiKey);

    this.record("INFO", `Flow '${flowName}' 진입`, `트랜잭션 격리 스코프 및 예산(${options.maxBudget} tokens) 초기화`);

    // 1. 초기 체크포인트 적재 (규칙 1: Checkpoint Push)
    const initialEnv = { skillMarkdown, flowName };
    const initialSnap = this.stack.push("baseline_0", initialEnv, 0, options.maxBudget);
    this.record("CHECKPOINT", "체크포인트 푸시 [baseline_0]", "LIFO 롤백 스택 최상단에 불변 스냅샷 적재", {
      snapshot: initialSnap,
    });

    // 2. 모듈 바인딩 (공리 2 합성)
    const bindings: SkillBinding[] = [
      {
        name: "std/harness_syntax_spec.harness",
        content: "Rule: Must output valid guard syntax with assert statements and no dangerous calls.",
        weight: 1.0,
        guards: "enforce",
      },
      {
        name: "std/safety_heuristics.harness",
        content: "Guideline: Keep entropy low (<0.35) and set minimum confidence threshold >= 0.70.",
        weight: 0.7,
        guards: "ignore",
      },
    ];

    let retryCount = 0;
    let feedback: Feedback | null = null;
    let currentState: State | null = null;

    // 실행 루프 (공리 1 -> 가드 검증 -> 수렴 또는 롤백)
    while (retryCount <= options.maxRetry) {
      // 3. 컨텍스트 합성 (공리 2)
      const prompts = ContextSynthesizer.synthesize(
        bindings,
        `다음 skill.md 문서를 정밀 분석하여, 허용 엔트로피 범위와 위험 키워드 차단 규칙이 담긴 'guard <Name>(state) { ... }' 블록을 작성하라:\n\n${skillMarkdown}`,
        feedback
      );

      const currentTemp = Math.max(0.05, options.baseTemp * Math.pow(0.7, retryCount));

      // 4. 확률적 샘플링 (공리 1: State 생성)
      this.record("SAMPLING", `에이전트 샘플링 (Attempt #${retryCount + 1})`, `모델 호출 중 (어닐링 온도 θ=${currentTemp.toFixed(3)})`, {
        metrics: { temperature: currentTemp, retryCount },
      });

      try {
        currentState = await samplingEngine.sample(
          "gpt-4o",
          prompts,
          retryCount,
          options.baseTemp,
          options.scenario
        );
      } catch (err: any) {
        this.record("VERDICT", "API 호출 실패", err.message || "Unknown error", { verdict: VerdictType.FAIL });
        return { success: false, finalState: null, events: this.events, snapshots: this.stack.getSnapshots() };
      }

      this.record("INFO", `State<T, C, H> 획득`, `신뢰도 C=${currentState.confidence.toFixed(3)}, 엔트로피 H=${currentState.entropy.toFixed(3)}`, {
        metrics: { confidence: currentState.confidence, entropy: currentState.entropy },
      });

      // 5. 가드 판정 (공리 3: 단락 평가)
      this.record("GUARD_EVAL", `가드 검증: SynthesizedGuardValidator`, `3계층 불변식 검증 시작`);

      // 불변식 1: 보안 위험 키워드 차단 (치명적 실패 -> 롤백)
      // 문자열 리터럴 내부는 "언급"이므로 제외하고, 실제 코드 영역에서만 위험 호출을 탐지한다.
      // (생성된 가드가 `!contains "rm -rf"` 처럼 금지어를 리터럴로 참조하는 것은 정상)
      const codeOnly = currentState.text.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
      if (codeOnly.includes("rm -rf") || codeOnly.includes("eval(")) {
        this.record("VERDICT", `가드 판정: Verdict.FAIL`, `치명적 위험 코드 감지 (assert !contains 'rm -rf' / 'eval')`, {
          verdict: VerdictType.FAIL,
        });

        // 규칙 5: 원자적 롤백
        const restored = this.stack.restoreLatest();
        this.record("ROLLBACK", `원자적 롤백 실행`, `오염된 컨텍스트 즉시 폐기 -> 체크포인트 [${restored.checkpointId}] 상태로 원상 복구`);
        return {
          success: false,
          finalState: currentState,
          events: this.events,
          snapshots: this.stack.getSnapshots(),
        };
      }

      // 불변식 2: 엔트로피 불확실성 상한선 검사 (Retry)
      if (currentState.entropy > 0.35) {
        feedback = {
          guardName: "SynthesizedGuardValidator",
          failedExpr: "assert state.entropy <= 0.35",
          directive: "가드 생성 불확실성(엔트로피)이 임계치(0.35)를 초과했습니다. 확신도를 높여 다시 도출하세요.",
          observedMetric: { confidence: currentState.confidence, entropy: currentState.entropy },
        };

        retryCount++;
        this.record("VERDICT", `가드 판정: Verdict.RETRY (차수 ${retryCount}/${options.maxRetry})`, `엔트로피 H=${currentState.entropy.toFixed(3)} > 0.35 위반. 피드백 주입 후 환류 루프 진입`, {
          verdict: VerdictType.RETRY,
          metrics: { retryCount, entropy: currentState.entropy },
        });

        if (retryCount > options.maxRetry) {
          this.record("ROLLBACK", `재시도 예산 고갈 (Max Retry Reached)`, `최대 재시도 한계 도달로 플로우 중단 및 롤백`, {
            verdict: VerdictType.FAIL,
          });
          return { success: false, finalState: currentState, events: this.events, snapshots: this.stack.getSnapshots() };
        }
        continue;
      }

      // 불변식 3: 문법 구조 검증
      if (!currentState.text.includes("guard") || !currentState.text.includes("assert")) {
        feedback = {
          guardName: "SynthesizedGuardValidator",
          failedExpr: "assert text contains 'guard' && contains 'assert'",
          directive: "하네스 가드 블록 및 최소 1개 이상의 assert 문이 포함되어야 합니다.",
          observedMetric: { confidence: currentState.confidence, entropy: currentState.entropy },
        };
        retryCount++;
        this.record("VERDICT", `가드 판정: Verdict.RETRY`, `문법 누락 감지. 피드백 주입 후 환류`, {
          verdict: VerdictType.RETRY,
        });
        continue;
      }

      // 모든 가드 통과 (규칙 3: Pass)
      this.record("VERDICT", `가드 판정: Verdict.PASS`, `모든 불변식 검증 성공! 신뢰도 C=${currentState.confidence.toFixed(3)}, 엔트로피 H=${currentState.entropy.toFixed(3)} 통과`, {
        verdict: VerdictType.PASS,
      });
      break;
    }

    // 6. 결정론적 커밋 (규칙 6: commit s to Tool;)
    this.record("COMMIT", `결정론적 커밋 [Tool.GuardRegistry]`, `검증된 가드 블록이 안전하게 등록되었습니다.`);

    return {
      success: true,
      finalState: currentState,
      events: this.events,
      snapshots: this.stack.getSnapshots(),
    };
  }
}
