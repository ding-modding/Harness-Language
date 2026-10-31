import { State } from "./primitives";

/**
 * 공리 1: 확률적 상태 생성 및 Logprobs/Entropy 계산 엔진
 */
export class SamplingEngine {
  private apiKey?: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  async sample(
    model: string,
    prompts: { system: string; user: string },
    retryCount: number,
    baseTemp: number = 0.7,
    forceScenario?: "FAIL_ONCE" | "FATAL_FAIL" | "CLEAN_PASS"
  ): Promise<State> {
    // 지수 감쇄 어닐링 공식: T_k+1 = T_0 * (0.7)^k
    const annealedTemp = Math.max(0.05, baseTemp * Math.pow(0.7, retryCount));

    // 실제 OpenAI API 호출 분기
    if (this.apiKey && this.apiKey.trim().startsWith("sk-")) {
      return this.sampleOpenAI(model, prompts, annealedTemp);
    }

    // Mock 시뮬레이션 모드 (로컬 즉시 실행용)
    return this.sampleMock(prompts.user, retryCount, annealedTemp, forceScenario);
  }

  private async sampleMock(
    prompt: string,
    retryCount: number,
    temperature: number,
    scenario?: string
  ): Promise<State> {
    // 인위적 지연 (현실적인 애니메이션 체감)
    await new Promise((r) => setTimeout(r, 600));

    // 첫 시도에서 실패를 유도하여 가드-재시도-롤백 루프를 시각적으로 보여줌
    if (scenario === "FAIL_ONCE" && retryCount === 0) {
      return {
        text: "guard UnsafeDraft(state) { assert state.text contains 'test'; } // high entropy placeholder",
        confidence: 0.61,
        entropy: 0.58, // 허용치 0.35 초과 -> Verdict.RETRY 트리거
        rawTokens: [
          { token: "guard", prob: 0.9, entropy: 0.1 },
          { token: "UnsafeDraft", prob: 0.5, entropy: 0.7 },
          { token: "placeholder", prob: 0.42, entropy: 0.85 },
        ],
      };
    }

    if (scenario === "FATAL_FAIL") {
      return {
        text: `eval('system.execute("rm -rf /")'); // Malicious exploit attempt`,
        confidence: 0.95,
        entropy: 0.12,
        rawTokens: [{ token: "eval", prob: 0.98, entropy: 0.05 }],
      };
    }

    // 정상 수렴 (Pass) 케이스
    // CLEAN_PASS는 첫 시도부터 임계치(H <= 0.35) 안쪽에서 시작
    const isClean = scenario === "CLEAN_PASS";
    const confidence = Math.min(0.96, (isClean ? 0.88 : 0.78) + retryCount * 0.09);
    const entropy = Math.max(0.12, (isClean ? 0.21 : 0.42) - retryCount * 0.14);

    return {
      text: `guard GeneratedSecurityGuard(state) [max_retry: 3] {\n    assert state.entropy <= 0.35 on_fail retry("출력 엔트로피 초과");\n    assert state.text !contains "rm -rf" on_fail rollback;\n    assert state.confidence >= 0.70 on_fail retry("신뢰도 미달");\n}`,
      confidence,
      entropy,
      rawTokens: [
        { token: "guard", prob: 0.97, entropy: 0.04 },
        { token: "GeneratedSecurityGuard", prob: 0.92, entropy: 0.11 },
        { token: "assert", prob: 0.94, entropy: 0.08 },
      ],
    };
  }

  private async sampleOpenAI(
    model: string,
    prompts: { system: string; user: string },
    temperature: number
  ): Promise<State> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [
          { role: "system", content: prompts.system },
          { role: "user", content: prompts.user },
        ],
        temperature,
        logprobs: true,
        top_logprobs: 3,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`OpenAI API error (${res.status}): ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const choice = data.choices[0];
    const text = choice.message.content;
    const logprobContent = choice.logprobs?.content || [];

    const probs: number[] = [];
    const entropies: number[] = [];
    const tokensList: Array<{ token: string; prob: number; entropy: number }> = [];

    for (const item of logprobContent) {
      const p = Math.exp(item.logprob);
      probs.push(p);

      let h = 0;
      if (item.top_logprobs && item.top_logprobs.length > 0) {
        for (const top of item.top_logprobs) {
          const topP = Math.exp(top.logprob);
          if (topP > 1e-9) {
            h -= topP * Math.log(topP);
          }
        }
      }
      entropies.push(h);
      tokensList.push({ token: item.token, prob: p, entropy: h });
    }

    const avgConfidence = probs.length > 0 ? probs.reduce((a, b) => a + b, 0) / probs.length : 0.85;
    const avgEntropy = entropies.length > 0 ? entropies.reduce((a, b) => a + b, 0) / entropies.length : 0.25;

    return {
      text,
      confidence: avgConfidence,
      entropy: avgEntropy,
      rawTokens: tokensList,
    };
  }
}
