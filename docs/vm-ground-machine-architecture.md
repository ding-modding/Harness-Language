# 하네스 VM 그라운드 머신 구현 아키텍처 (Ground Machine Architecture)

그라운드 머신은 소스 코드를 읽어 실행하는 파이프라인으로, 파이썬 기반의 5개 코어 서브시스템으로 분할 구현됩니다.

## 1. 아키텍처 개요
```
                     [ .harness 소스 코드 ]
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 1. Lexer & Parser (Lark Grammar)                            │
 │    - Lark EBNF 구문 분석 -> Harness AST 노드 트리 생성       │
 └──────────────────────────────┬──────────────────────────────┘
                                │ AST
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 2. Harness VM (Execution Coordinator)                       │
 │    - Program Counter (PC), 환경 맵(σ), 예산(β) 관리          │
 └──────┬───────────────────────┼───────────────────────┬──────┘
        │                       │                       │
        ▼                       ▼                       ▼
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│3. Synthesizer│        │4. Sampling   │        │5. Guard &    │
│  Context     │        │   Engine     │        │   Rollback   │
│- 가중합 프롬프트│       │- logprobs 수집 │       │- assert 단락평가│
│- W 투영 계산  │        │- C, H 튜플 계산│        │- 스택 LIFO 복원│
└──────────────┘        └──────────────┘        └──────────────┘
```

## 2. 서브시스템 구현 코드

### 서브시스템 1: 코어 데이터 모델 (`primitives.py`)
```python
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from enum import Enum

class VerdictType(Enum):
    PASS = "PASS"
    RETRY = "RETRY"
    FAIL = "FAIL"

@dataclass(frozen=True)
class State:
    """공리 1: 확률적 상태 튜플 S = <T, C, H>"""
    text: str
    confidence: float   # 0.0 ~ 1.0 (토큰 확률 평균)
    entropy: float      # >= 0.0 (정보 이론 엔트로피)
    raw_tokens: List[Dict[str, Any]] = field(default_factory=list)

@dataclass
class Feedback:
    """재시도 시 주입되는 진단 레코드"""
    guard_name: str
    failed_expr: str
    directive: str
    observed_metric: Dict[str, float]

@dataclass
class CheckpointSnapshot:
    """공리 3: LIFO 롤백 스택 프레임"""
    checkpoint_id: str
    env_snapshot: Dict[str, Any]
    retry_pc: int
    budget_snapshot: int
```

### 서브시스템 2: 롤백 스택 엔진 (`rollback_stack.py`)
```python
import copy

class RollbackStack:
    def __init__(self):
        self._stack: List[CheckpointSnapshot] = []

    def push(self, checkpoint_id: str, env: Dict[str, Any], pc: int, budget: int):
        snapshot = CheckpointSnapshot(
            checkpoint_id=checkpoint_id,
            env_snapshot=copy.deepcopy(env),
            retry_pc=pc,
            budget_snapshot=budget
        )
        self._stack.append(snapshot)

    def peek(self) -> Optional[CheckpointSnapshot]:
        return self._stack[-1] if self._stack else None

    def pop(self) -> Optional[CheckpointSnapshot]:
        return self._stack.pop() if self._stack else None

    def restore_latest(self) -> tuple[Dict[str, Any], int]:
        """최신 체크포인트 환경 복원 (스택 프레임은 유지)"""
        if not self._stack:
            raise RuntimeError("Harness Panic: Checkpoint stack is empty. Cannot rollback.")
        latest = self._stack[-1]
        return copy.deepcopy(latest.env_snapshot), latest.retry_pc
```

### 서브시스템 3: 컨텍스트 합성기 (`synthesizer.py`)
```python
class ContextSynthesizer:
    @staticmethod
    def synthesize(bindings: List[tuple[str, float]], base_prompt: str, feedback: Optional[Feedback]) -> Dict[str, str]:
        system_rules = []
        user_guidelines = []

        for module_content, weight in bindings:
            if weight >= 1.0:
                system_rules.append(f"[STRICT INVARIANT (Weight {weight})]\n{module_content}")
            else:
                user_guidelines.append(f"[STYLE REFERENCE (Weight {weight})]\n{module_content}")

        system_payload = "\n\n".join(system_rules)
        user_payload = base_prompt

        if user_guidelines:
            user_payload += "\n\n### Reference Guidelines:\n" + "\n\n".join(user_guidelines)

        if feedback:
            user_payload += (
                f"\n\n[SYSTEM DIAGNOSTIC FEEDBACK]\n"
                f"- Violated Rule: {feedback.failed_expr}\n"
                f"- Directive: {feedback.directive}\n"
                f"- Action: 이전 오류를 즉시 수정하여 다시 작성하십시오."
            )

        return {
            "system": system_payload,
            "user": user_payload
        }
```

### 서브시스템 4: 샘플링 엔진 (`sampling_engine.py`)
```python
import math

class SamplingEngine:
    def __init__(self, client):
        self.client = client  # OpenAI, LiteLLM 또는 vLLM 클라이언트

    def sample(self, model: str, prompts: Dict[str, str], retry_count: int, base_temp: float = 0.7) -> State:
        # 지수 감쇄 어닐링 정책 적용
        annealed_temp = max(0.05, base_temp * (0.7 ** retry_count))

        response = self.client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": prompts["system"]},
                {"role": "user", "content": prompts["user"]}
            ],
            temperature=annealed_temp,
            logprobs=True,
            top_logprobs=5
        )

        choice = response.choices[0]
        text_output = choice.message.content
        logprob_content = choice.logprobs.content

        probs = []
        token_entropies = []

        for token_info in logprob_content:
            p = math.exp(token_info.logprob)
            probs.append(p)

            # 토큰별 엔트로피 H = -sum(p * log(p))
            h = 0.0
            if token_info.top_logprobs:
                for top in token_info.top_logprobs:
                    top_p = math.exp(top.logprob)
                    if top_p > 1e-9:
                        h -= top_p * math.log(top_p)
            token_entropies.append(h)

        avg_confidence = sum(probs) / len(probs) if probs else 1.0
        avg_entropy = sum(token_entropies) / len(token_entropies) if token_entropies else 0.0

        return State(
            text=text_output,
            confidence=avg_confidence,
            entropy=avg_entropy
        )
```

### 서브시스템 5: 가드 인터셉터 및 가상머신 루프 (`harness_vm.py`)
```python
class HarnessVM:
    def __init__(self, sampling_engine: SamplingEngine):
        self.sampling_engine = sampling_engine
        self.stack = RollbackStack()
        self.env: Dict[str, Any] = {}
        self.retry_register: Dict[str, int] = {}
        self.budget = 100

    def evaluate_guard(self, guard_decl, state: State) -> tuple[VerdictType, Optional[Feedback]]:
        """가드 블록 내부의 assert 문 순차적 단락 평가"""
        eval_ctx = {
            "draft": state,
            "text": state.text,
            "confidence": state.confidence,
            "entropy": state.entropy
        }

        for assert_stmt in guard_decl.assert_stmts:
            is_valid = eval(assert_stmt.py_expression, {}, eval_ctx)
            if not is_valid:
                action = assert_stmt.action_type
                if action == "retry":
                    fb = Feedback(
                        guard_name=guard_decl.name,
                        failed_expr=assert_stmt.raw_expr,
                        directive=assert_stmt.directive_msg,
                        observed_metric={"confidence": state.confidence, "entropy": state.entropy}
                    )
                    return VerdictType.RETRY, fb
                elif action in ("rollback", "fail"):
                    return VerdictType.FAIL, None

        return VerdictType.PASS, None

    def execute_flow(self, flow_ast, initial_input: str):
        self.env["task_input"] = initial_input
        self.env["__feedback__"] = None
        pc = 0
        statements = flow_ast.statements

        while pc < len(statements):
            if self.budget <= 0:
                raise RuntimeError("Harness Panic: Resource Budget Exhausted (β <= 0)")

            stmt = statements[pc]
            self.budget -= 1

            if stmt.type == "CHECKPOINT":
                self.stack.push(stmt.name, self.env, pc + 1, self.budget)
                pc += 1

            elif stmt.type == "STOCHASTIC_BIND":
                guard_key = stmt.target_agent
                current_retry = self.retry_register.get(guard_key, 0)
                
                prompts = ContextSynthesizer.synthesize(
                    stmt.context_bindings,
                    self.env["task_input"],
                    self.env.get("__feedback__")
                )
                state_result = self.sampling_engine.sample(
                    model="gpt-4o",
                    prompts=prompts,
                    retry_count=current_retry
                )
                self.env[stmt.var_name] = state_result
                pc += 1

            elif stmt.type == "ENFORCE":
                guard_decl = stmt.guard_decl
                target_state = self.env[stmt.state_var]
                guard_name = guard_decl.name
                current_retry = self.retry_register.get(guard_name, 0)
                max_retry = guard_decl.max_retry

                verdict, feedback = self.evaluate_guard(guard_decl, target_state)

                if verdict == VerdictType.PASS:
                    self.retry_register[guard_name] = 0
                    self.env["__feedback__"] = None
                    pc += 1

                elif verdict == VerdictType.RETRY:
                    if current_retry < max_retry:
                        self.retry_register[guard_name] = current_retry + 1
                        restored_env, retry_pc = self.stack.restore_latest()
                        self.env = restored_env
                        self.env["__feedback__"] = feedback
                        pc = retry_pc
                    else:
                        self.stack.pop()
                        raise RuntimeError(f"Harness Abort: Retry budget exhausted for guard '{guard_name}'.")

                elif verdict == VerdictType.FAIL:
                    self.stack.pop()
                    raise RuntimeError(f"Harness Abort: Guard '{guard_name}' triggered fatal rollback.")

            elif stmt.type == "COMMIT":
                target_tool = stmt.tool_name
                state_data = self.env[stmt.state_var]
                print(f"[TOOL COMMIT] Successfully committed to {target_tool}: {state_data.text[:40]}...")
                self.env["__committed__"] = True
                pc += 1

        return self.env.get("__committed__", False)
```
