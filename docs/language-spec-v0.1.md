# 하네스 프로그래밍 언어 코어 규격서 (Language Specification v0.1)

## 1. 어휘 및 구문 명세 (EBNF Grammar)
본 규격은 1차원 순차 실행 흐름과 단일 단계 롤백/환류를 지원하는 최소 코어 문법입니다.

```ebnf
(* 최상위 프로그램 *)
Program          ::= { ImportDecl } { TopLevelDecl } FlowDecl ;

TopLevelDecl     ::= AgentDecl | GuardDecl ;

(* 1. 모듈 선언 *)
ImportDecl       ::= "import" StringLiteral "as" Identifier 
                     "{" "weight" ":" FloatLiteral "," "guards" ":" GuardInherit "}" ";" ;
GuardInherit     ::= "enforce" | "ignore" ;

(* 2. 에이전트 선언 (순수 입출력 샘플러) *)
AgentDecl        ::= "agent" Identifier "{" "model" ":" StringLiteral ";" "}" ;

(* 3. 가드 선언 (불변식 검사기) *)
GuardDecl        ::= "guard" Identifier "(" Identifier ")" [ GuardConfig ] "{" { AssertStmt } "}" ;
GuardConfig      ::= "[" "max_retry" ":" IntegerLiteral "]" ;
AssertStmt       ::= "assert" Expression "on_fail" Action ";" ;
Action           ::= "retry" "(" StringLiteral ")" | "rollback" | "fail" ;

(* 4. 1차원 선형 플로우 (Flow) *)
FlowDecl         ::= "flow" Identifier "(" Identifier ")" "{" { FlowStmt } "}" ;
FlowStmt         ::= CheckpointStmt
                   | StochasticBindStmt
                   | EnforceStmt
                   | CommitStmt ;

CheckpointStmt   ::= "checkpoint" Identifier ";" ;
StochasticBindStmt ::= "state" Identifier "~>" Identifier "(" Expression ")" 
                       [ "guided_by" CompositeContext ] ";" ;

CompositeContext ::= ContextTerm { "+" ContextTerm } ;
ContextTerm      ::= Identifier "*" FloatLiteral ;

EnforceStmt      ::= "enforce" Identifier "(" Identifier ")" ";" ;
CommitStmt       ::= "commit" Identifier "to" Identifier ";" ;

(* 5. 표현식 및 연산자 *)
Expression       ::= LogicalOrExp ;
LogicalOrExp     ::= LogicalAndExp { "||" LogicalAndExp } ;
LogicalAndExp    ::= RelationalExp { "&&" RelationalExp } ;
RelationalExp    ::= PrimaryExp ( "==" | "!=" | "<" | "<=" | ">" | ">=" | "contains" ) PrimaryExp ;
PrimaryExp       ::= Identifier { "." Identifier } | Literal ;
Literal          ::= FloatLiteral | StringLiteral | IntegerLiteral | BooleanLiteral ;
```

## 2. 정형 의미론 (Formal Semantics)

### 2.1 도메인 및 머신 형상 (Machine Configuration)
플로우의 런타임 형상 $\Sigma$는 다음 5-튜플로 정의됩니다.
$$\Sigma = \langle \mathcal{P}, \mathcal{K}, \sigma, \beta, \rho \rangle \in \mathbf{Conf}$$
* $\mathcal{P} \in \mathbf{Cmd}^*$: 잔여 순차 명령문 리스트 ($stmt :: \mathcal{P}$)
* $\mathcal{K} \in \mathbf{Stack}$: 체크포인트 LIFO 스택 $[(id, \sigma_{\text{snap}}, \mathcal{P}_{\text{retry}}), \dots]$
* $\sigma \in \mathbf{Env}$: 변수 환경 맵 ($\mathbf{Ident} \rightarrow \mathbf{Value} \cup \mathbf{State}$)
  * $\mathbf{State} = \langle T \in \mathbf{String}, C \in [0, 1], H \in \mathbb{R}_{\ge 0} \rangle$
* $\beta \in \mathbb{N}$: 잔여 자원 및 토큰 예산 (Step Budget)
* $\rho \in \mathbf{Ident} \rightarrow \mathbb{N}$: 가드별 누적 재시도 횟수 레지스터

### 2.2 연산자 조작적 의미론 (Operational Semantics Rules)

#### [소프트 합성 연산자 ($\oplus_w$)]
두 모듈 $M_1, M_2$의 선형 결합은 시스템 프롬프트 어텐션 가중치 벡터 $\mathbf{W}$로 투영됩니다.
$$\text{Synth}(M_1 * w_1 + M_2 * w_2) = \mathcal{C}_{\text{composite}}$$
$$\mathcal{C}_{\text{composite}} = \big[\text{Role}(M_1, \text{priority}=w_1) \parallel \text{Role}(M_2, \text{priority}=w_2)\big]$$
* $w_i = 1.0$은 System Prompt의 무조건적 불변 규칙으로 주입됩니다.
* $w_i < 1.0$은 User Prompt 하단의 참조 가이드라인(Reference Bias)으로 격하되어 주입됩니다.

#### [체크포인트 적재 (`checkpoint c;`)]
현재 환경 $\sigma$와 체크포인트 선언 직후의 실행 지점 $\mathcal{P}$를 스택에 적재합니다.
$$\frac{}{\langle \text{checkpoint } c; :: \mathcal{P}, \; \mathcal{K}, \; \sigma, \; \beta, \; \rho \rangle \;\longrightarrow\; \langle \mathcal{P}, \; (c, \sigma, \mathcal{P}) :: \mathcal{K}, \; \sigma, \; \beta - 1, \; \rho \rangle}$$

#### [확률적 바인딩 (`state s ~> A(input) guided_by C;`)]
합성된 컨텍스트 $\mathcal{C}$와 현재 재시도 차수 $k = \rho(\mathcal{G})$에 따른 어닐링 온도 $\theta = \text{Anneal}(k)$를 적용하여 모델로부터 $\langle T, C, H \rangle$를 샘플링합니다.
$$\frac{\mathcal{C} = \text{Synth}(C) \quad \theta = T_0 \times (0.7)^k \quad \mathcal{A}(input, \mathcal{C}, \theta) \Downarrow \langle T, C, H \rangle}{\langle \text{state } s \sim> \mathcal{A}(input) \dots; :: \mathcal{P}, \; \mathcal{K}, \; \sigma, \; \beta, \; \rho \rangle \;\longrightarrow\; \langle \mathcal{P}, \; \mathcal{K}, \; \sigma[s \mapsto \langle T, C, H \rangle], \; \beta - 1, \; \rho \rangle}$$

#### [가드 판정: 단락 평가 (Short-Circuit Evaluation)]
가드 $\mathcal{G}$ 내부의 `assert` 구문들은 선언 순서대로 평가되며, 첫 번째 위반 시점에서 즉시 판정이 붕괴합니다.
$$\Downarrow_{\mathcal{G}}(S) = \begin{cases}
\text{Fail} & \text{첫 위반 assert의 액션이 rollback 또는 fail인 경우} \\
\text{Retry}(\mathcal{F}) & \text{첫 위반 assert의 액션이 retry(msg)인 경우} \\
\text{Pass} & \text{모든 assert가 True인 경우}
\end{cases}$$

#### [가드 전이: Pass (`enforce G(s);`)]
모든 불변식을 통과하면 환경 $\sigma$를 보존하고 다음 명령으로 전진합니다.
$$\frac{\sigma(s) = S \quad \mathcal{G}(S) \Downarrow \text{Pass}}{\langle \text{enforce } \mathcal{G}(s); :: \mathcal{P}, \; \mathcal{K}, \; \sigma, \; \beta, \; \rho \rangle \;\longrightarrow\; \langle \mathcal{P}, \; \mathcal{K}, \; \sigma, \; \beta - 1, \; \rho \rangle}$$

#### [가드 전이: Retry (`enforce G(s);`)]
불변식 위반 시 재시도 한계 $k_{\max}$ 미만이면, 생성된 $s$를 메모리에서 제거하고 피드백 진단 레코드 $\mathcal{F}$를 주입하여 체크포인트 지점 $\mathcal{P}_{\text{retry}}$로 역방향 점프합니다.
$$\frac{\sigma(s) = S \quad \mathcal{G}(S) \Downarrow \text{Retry}(\mathcal{F}) \quad \rho(\mathcal{G}) = k < k_{\max} \quad \mathcal{K} = (c, \sigma_{\text{snap}}, \mathcal{P}_{\text{retry}}) :: \mathcal{K}'}{\langle \text{enforce } \mathcal{G}(s); :: \mathcal{P}, \; \mathcal{K}, \; \sigma, \; \beta, \; \rho \rangle \;\longrightarrow\; \langle \mathcal{P}_{\text{retry}}, \; \mathcal{K}, \; \sigma_{\text{snap}}[\text{__feedback__} \mapsto \mathcal{F}], \; \beta - 1, \; \rho[\mathcal{G} \mapsto k + 1] \rangle}$$

#### [가드 전이: Fail 및 예산 소진]
치명적 오류 또는 $k \ge k_{\max}$ 도달 시 오염된 메모리를 파기하고 직전 체크포인트 환경 $\sigma_{\text{snap}}$으로 복원한 뒤 플로우를 중단합니다.
$$\frac{\sigma(s) = S \quad (\mathcal{G}(S) \Downarrow \text{Fail} \;\lor\; \rho(\mathcal{G}) \ge k_{\max}) \quad \mathcal{K} = (c, \sigma_{\text{snap}}, \mathcal{P}_{\text{retry}}) :: \mathcal{K}'}{\langle \text{enforce } \mathcal{G}(s); :: \mathcal{P}, \; \mathcal{K}, \; \sigma, \; \beta, \; \rho \rangle \;\longrightarrow\; \langle \mathbf{abort}, \; \mathcal{K}', \; \sigma_{\text{snap}}, \; \beta - 1, \; \rho \rangle}$$

#### [결정론적 커밋 (`commit s to Tool;`)]
상태 $s$의 비정형 텍스트 $T$를 결정론적 도구 인터페이스로 방출합니다.
$$\frac{\sigma(s) = \langle T, C, H \rangle \quad \text{ToolExec}(Tool, T) \Downarrow R}{\langle \text{commit } s \text{ to } Tool; :: \mathcal{P}, \; \mathcal{K}, \; \sigma, \; \beta, \; \rho \rangle \;\longrightarrow\; \langle \mathcal{P}, \; \mathcal{K}, \; \sigma[\text{__committed__} \mapsto R], \; \beta - 1, \; \rho \rangle}$$
