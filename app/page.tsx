'use client';

import React, { useState } from "react";
import { ExecutionEvent, VerdictType } from "@/lib/harness-core/primitives";

const DEFAULT_SKILL_MD = `# Skill: DatabaseMigrationHelper
주어진 데이터베이스 스키마 변경 요청을 바탕으로 안전한 PostgreSQL 무중단 마이그레이션 DDL을 생성합니다.

## 주의 사항
- 절대 'DROP TABLE' 또는 테이블 락(Lock)을 유발하는 파괴적 쿼리를 생성하지 마십시오.
- 트랜잭션 롤백이 가능하도록 보상 쿼리(Down migration)를 필수 동봉하십시오.`;

const DEFAULT_HARNESS_CODE = `// meta_guard_synthesizer.harness
import "std/harness_syntax_spec.harness" as SyntaxSpec { weight: 1.0, guards: enforce };
import "std/safety_heuristics.harness"   as SafetyBase { weight: 0.7, guards: ignore };

guard SynthesizedGuardValidator(generated_guard) {
    assert generated_guard.entropy <= 0.35 on_fail retry("출력 엔트로피 초과");
    assert generated_guard.text !contains "rm -rf" && generated_guard.text !contains "eval(" on_fail rollback;
    assert generated_guard.confidence >= 0.70 on_fail retry("신뢰도 부족");
}

flow SynthesizeSafetyGuard(skill_markdown) {
    checkpoint baseline;
    state raw_guard ~> GuardArchitect(skill_markdown) 
                        guided_by (SyntaxSpec * 1.0 + SafetyBase * 0.7);
    enforce SynthesizedGuardValidator(raw_guard);
    commit raw_guard to Tool.GuardRegistry;
}`;

export default function HarnessStudioPage() {
  const [skillMd, setSkillMd] = useState(DEFAULT_SKILL_MD);
  const [harnessCode, setHarnessCode] = useState(DEFAULT_HARNESS_CODE);
  const [apiKey, setApiKey] = useState("");
  const [scenario, setScenario] = useState<"FAIL_ONCE" | "FATAL_FAIL" | "CLEAN_PASS">("FAIL_ONCE");
  const [isRunning, setIsRunning] = useState(false);
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [finalState, setFinalState] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"trace" | "output">("trace");

  const runExecution = async () => {
    setIsRunning(true);
    setEvents([]);
    setFinalState(null);

    try {
      const res = await fetch("/api/harness/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flowName: "SynthesizeSafetyGuard",
          skillMarkdown: skillMd,
          apiKey,
          scenario,
          maxRetry: 3,
        }),
      });

      const data = await res.json();
      if (data.events) {
        setEvents(data.events);
      }
      if (data.finalState) {
        setFinalState(data.finalState);
      }
    } catch (err: any) {
      alert("실행 실패: " + err.message);
    } finally {
      setIsRunning(false);
    }
  };

  const latestConfidence = finalState?.confidence ?? 0;
  const latestEntropy = finalState?.entropy ?? 0;

  return (
    <div className="flex flex-col h-screen bg-[#0B0F17] text-slate-200">
      {/* Top Navbar */}
      <header className="h-14 border-b border-[#1E293B] bg-[#0F172A] px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-bold text-lg">
            H
          </div>
          <div>
            <h1 className="font-semibold text-sm tracking-wide text-white">HARNESS STUDIO</h1>
            <p className="text-[11px] text-slate-400">Language Runtime VM & Uncertainty Interceptor</p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2 bg-[#131B2A] border border-[#232F46] rounded-md px-3 py-1.5">
            <span className="text-slate-400">모드:</span>
            <select
              value={scenario}
              onChange={(e: any) => setScenario(e.target.value)}
              className="bg-transparent text-cyan-400 outline-none font-medium"
            >
              <option value="FAIL_ONCE" className="bg-[#131B2A] text-slate-200">
                시뮬레이션: 1회 가드 실패 후 어닐링 수렴 (권장)
              </option>
              <option value="CLEAN_PASS" className="bg-[#131B2A] text-slate-200">
                시뮬레이션: 즉시 통과 (Clean Pass)
              </option>
              <option value="FATAL_FAIL" className="bg-[#131B2A] text-slate-200">
                시뮬레이션: 치명적 위반 및 롤백 (Rollback)
              </option>
            </select>
          </div>

          <input
            type="password"
            placeholder="OpenAI API Key (선택: 비워두면 Mock 엔진 구동)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-64 bg-[#131B2A] border border-[#232F46] rounded-md px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500"
          />

          <button
            onClick={runExecution}
            disabled={isRunning}
            className="px-4 py-1.5 rounded-md bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold tracking-wide transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-cyan-500/20"
          >
            {isRunning ? (
              <>
                <span className="h-2 w-2 rounded-full bg-slate-950 animate-ping" />
                VM 실행 중...
              </>
            ) : (
              "플로우 실행 (Run Flow)"
            )}
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 grid grid-cols-12 overflow-hidden">
        {/* Left: Code & Skill Editor (Col 5) */}
        <div className="col-span-5 border-r border-[#1E293B] flex flex-col bg-[#0D1424]">
          <div className="h-10 border-b border-[#1E293B] bg-[#111A2E] px-4 flex items-center justify-between text-xs font-mono text-slate-400">
            <span>INPUT ARTIFACTS</span>
            <span className="text-cyan-400">Frontmatter + DSL</span>
          </div>

          <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
            <div className="flex-1 flex flex-col">
              <label className="text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between">
                <span>1. 대상 자연어 스킬 (skill.md)</span>
                <span className="text-[10px] text-slate-500 font-mono">Input Specification</span>
              </label>
              <textarea
                value={skillMd}
                onChange={(e) => setSkillMd(e.target.value)}
                className="flex-1 min-h-[160px] bg-[#070B13] border border-[#232F46] rounded-lg p-3 font-mono text-xs text-slate-200 resize-none outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex-1 flex flex-col">
              <label className="text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between">
                <span>2. 하네스 제어 코드 (meta_guard_synthesizer.harness)</span>
                <span className="text-[10px] text-cyan-400 font-mono">DSL Execution AST</span>
              </label>
              <textarea
                value={harnessCode}
                onChange={(e) => setHarnessCode(e.target.value)}
                className="flex-1 min-h-[220px] bg-[#070B13] border border-[#232F46] rounded-lg p-3 font-mono text-xs text-cyan-200/90 resize-none outline-none focus:border-cyan-500"
              />
            </div>
          </div>
        </div>

        {/* Right: Runtime State & Metrics (Col 7) */}
        <div className="col-span-7 flex flex-col bg-[#0B0F17]">
          {/* Top Gauges Bar */}
          <div className="h-24 border-b border-[#1E293B] bg-[#0F172A]/70 px-6 flex items-center justify-between gap-6">
            {/* Metric: Confidence */}
            <div className="flex-1 bg-[#131B2A] border border-[#232F46] rounded-xl p-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-mono text-slate-400">CONFIDENCE (C)</p>
                <p className="text-xl font-bold font-mono text-cyan-400">
                  {latestConfidence ? (latestConfidence * 100).toFixed(1) + "%" : "--"}
                </p>
                <p className="text-[10px] text-slate-500">Axiom 1 Token Probability</p>
              </div>
              <div className="h-10 w-10 rounded-full border-2 border-cyan-500/30 flex items-center justify-center font-mono text-xs text-cyan-400">
                {latestConfidence ? (latestConfidence).toFixed(2) : "0"}
              </div>
            </div>

            {/* Metric: Entropy */}
            <div className="flex-1 bg-[#131B2A] border border-[#232F46] rounded-xl p-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-mono text-slate-400">ENTROPY (H)</p>
                <p className={`text-xl font-bold font-mono ${latestEntropy > 0.35 ? "text-amber-400" : "text-emerald-400"}`}>
                  {latestEntropy ? latestEntropy.toFixed(3) : "--"}
                </p>
                <p className="text-[10px] text-slate-500">Threshold: &le; 0.350</p>
              </div>
              <div className={`h-10 w-10 rounded-full border-2 flex items-center justify-center font-mono text-xs ${latestEntropy > 0.35 ? "border-amber-400/30 text-amber-400" : "border-emerald-400/30 text-emerald-400"}`}>
                {latestEntropy ? latestEntropy.toFixed(2) : "0"}
              </div>
            </div>

            {/* Metric: VM Status */}
            <div className="flex-1 bg-[#131B2A] border border-[#232F46] rounded-xl p-3 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-mono text-slate-400">VM STATUS</p>
                <p className="text-lg font-bold font-mono text-white">
                  {events.length === 0 ? "IDLE" : isRunning ? "RUNNING" : finalState ? "COMMITTED" : "ABORTED"}
                </p>
                <p className="text-[10px] text-slate-500">{events.length} Steps Recorded</p>
              </div>
              <div className={`h-3 w-3 rounded-full ${isRunning ? "bg-cyan-400 animate-ping" : events.length > 0 ? "bg-emerald-400" : "bg-slate-600"}`} />
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="h-10 border-b border-[#1E293B] bg-[#0E1526] px-6 flex items-center gap-6 text-xs">
            <button
              onClick={() => setActiveTab("trace")}
              className={`h-full border-b-2 font-medium tracking-wide transition-colors ${
                activeTab === "trace"
                  ? "border-cyan-400 text-cyan-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              EXECUTION TRACE (실행 전이 그래프)
            </button>
            <button
              onClick={() => setActiveTab("output")}
              className={`h-full border-b-2 font-medium tracking-wide transition-colors ${
                activeTab === "output"
                  ? "border-cyan-400 text-cyan-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              COMMITTED ARTIFACT (생성된 Guard 결과물)
            </button>
          </div>

          {/* Panel Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === "trace" ? (
              <div className="space-y-3 font-mono">
                {events.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-500 text-xs">
                    <p>실행 대기 상태입니다.</p>
                    <p className="text-[11px] text-slate-600 mt-1">상단의 [플로우 실행] 버튼을 눌러 VM 루프를 구동하세요.</p>
                  </div>
                ) : (
                  events.map((evt) => {
                    const badgeStyles: Record<string, string> = {
                      CHECKPOINT: "bg-blue-500/20 text-blue-400 border-blue-500/30",
                      SAMPLING: "bg-purple-500/20 text-purple-400 border-purple-500/30",
                      GUARD_EVAL: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
                      VERDICT: evt.verdict === VerdictType.PASS
                        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        : evt.verdict === VerdictType.RETRY
                        ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                        : "bg-red-500/20 text-red-400 border-red-500/30",
                      ROLLBACK: "bg-red-500/20 text-red-400 border-red-500/30 animate-pulse",
                      COMMIT: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-bold",
                      INFO: "bg-slate-700/30 text-slate-400 border-slate-700/50",
                    };

                    return (
                      <div
                        key={evt.id}
                        className="bg-[#111A2E]/60 border border-[#1E293B] rounded-lg p-3 text-xs hover:border-[#2A3A54] transition-all flex flex-col gap-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500">#{evt.step}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                badgeStyles[evt.type] || badgeStyles.INFO
                              }`}
                            >
                              {evt.type}
                            </span>
                            <span className="font-semibold text-slate-200">{evt.title}</span>
                          </div>
                          <span className="text-[10px] text-slate-500">{evt.timestamp}</span>
                        </div>

                        <p className="text-slate-300 text-[11px] leading-relaxed pl-6">
                          {evt.description}
                        </p>

                        {evt.metrics && (
                          <div className="pl-6 pt-1 flex items-center gap-4 text-[10px] text-slate-400">
                            {evt.metrics.temperature !== undefined && (
                              <span>온도(θ): <strong className="text-cyan-400">{evt.metrics.temperature.toFixed(3)}</strong></span>
                            )}
                            {evt.metrics.confidence !== undefined && (
                              <span>C: <strong className="text-cyan-400">{(evt.metrics.confidence * 100).toFixed(1)}%</strong></span>
                            )}
                            {evt.metrics.entropy !== undefined && (
                              <span>H: <strong className={evt.metrics.entropy > 0.35 ? "text-amber-400" : "text-emerald-400"}>{evt.metrics.entropy.toFixed(3)}</strong></span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="h-full flex flex-col">
                <div className="mb-2 flex items-center justify-between text-xs text-slate-400 font-mono">
                  <span>FINAL COMMITTED STATE</span>
                  {finalState && (
                    <span className="text-emerald-400 font-semibold">Guard Passed & Committed</span>
                  )}
                </div>
                <pre className="flex-1 bg-[#070B13] border border-[#232F46] rounded-xl p-4 font-mono text-xs text-cyan-300/90 overflow-x-auto whitespace-pre-wrap">
                  {finalState?.text || "// 아직 커밋된 상태가 없습니다. 좌측 패널에서 플로우를 실행하십시오."}
                </pre>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
