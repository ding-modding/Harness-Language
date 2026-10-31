# Harness Studio (하네스 언어 실행 스튜디오 & VM)

AI 에이전트의 불확실성을 통제하고 제어 흐름(Control Flow)을 결정론적으로 강제하는 **하네스 언어(Harness DSL)**의 실행 가상머신 및 Next.js 대시보드 프로젝트입니다.

---

## 🚀 빠른 시작 가이드 (Quick Start)

### 1. 패키지 설치
터미널에서 압축을 푼 폴더로 이동한 후 아래 명령어를 실행합니다:
```bash
npm install
```

### 2. 로컬 개발 서버 실행
```bash
npm run dev
```
브라우저에서 [http://localhost:3000](http://localhost:3000)으로 접속하면 하네스 스튜디오 대시보드가 열립니다.

* **Mock 엔진 내장:** OpenAI API 키를 입력하지 않아도 가드 판정(Verdict.Pass / Retry / Rollback)과 어닐링(Annealing) 과정이 시뮬레이션됩니다.
* **실제 API 연동:** 우측 상단 인풋에 OpenAI API Key(`sk-...`)를 입력하면 실제 `logprobs`와 엔트로피($H$)를 계산하여 실시간으로 실행합니다.

---

## 📦 프로젝트 구조

```text
harness-studio/
├── app/
│   ├── layout.tsx              # 전역 레이아웃 및 폰트
│   ├── globals.css             # Tailwind CSS 설정
│   ├── page.tsx                # 하네스 스튜디오 통합 웹 UI
│   └── api/
│       └── harness/
│           └── execute/
│               └── route.ts    # 하네스 VM 실행 및 API 엔드포인트
├── lib/
│   └── harness-core/
│       ├── primitives.ts       # State<T, C, H>, Verdict, Feedback 정의
│       ├── rollback-stack.ts   # Checkpoint 스냅샷 격리 및 LIFO 롤백 엔진
│       ├── synthesizer.ts      # 공리 2: 소프트 합성 연산자 (Prompt Synthesizer)
│       ├── sampling-engine.ts  # 공리 1: Logprobs/Entropy 추출 & 어닐링 엔진
│       └── vm.ts               # 공리 3: 단락 평가 가드 & 수렴 롤백 VM 루프
├── examples/
│   ├── meta_guard_synthesizer.harness
│   └── sample_skill.md
├── package.json
└── tsconfig.json
```

---

## 언어 문서

- [하네스 언어 코어 규격서 v0.1 (Syntax & Semantics)](docs/language-spec-v0.1.md)
- [하네스 VM 그라운드 머신 구현 아키텍처](docs/vm-ground-machine-architecture.md)
