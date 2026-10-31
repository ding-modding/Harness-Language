import { Feedback } from "./primitives";

export interface SkillBinding {
  name: string;
  content: string;
  weight: number;      // 0.0 ~ 1.0 (Soft ~ Hard)
  guards: "enforce" | "ignore";
}

/**
 * 공리 2: 소프트 합성 연산자 (Prompt & Context Synthesizer)
 */
export class ContextSynthesizer {
  static synthesize(
    bindings: SkillBinding[],
    basePrompt: string,
    feedback: Feedback | null
  ): { system: string; user: string } {
    const systemRules: string[] = [
      "You are an AI agent governed strictly by the Harness Language Runtime VM.",
    ];
    const userGuidelines: string[] = [];

    // 가중치에 따른 컨텍스트 분기 투영
    for (const b of bindings) {
      if (b.weight >= 1.0) {
        systemRules.push(`[HARD INVARIANT RULE (Weight ${b.weight.toFixed(1)}) - Source: ${b.name}]
${b.content}`);
      } else {
        userGuidelines.push(`[SOFT STYLE GUIDELINE (Weight ${b.weight.toFixed(1)}) - Source: ${b.name}]
${b.content}`);
      }
    }

    let userPayload = basePrompt;
    if (userGuidelines.length > 0) {
      userPayload += "\n\n### Contextual Reference Guidelines:\n" + userGuidelines.join("\n\n");
    }

    // 실패 피드백 주입 (공리 3 환류)
    if (feedback) {
      userPayload += `\n\n[SYSTEM DIAGNOSTIC FEEDBACK: ATTEMPT FIX]\n` +
        `- Violated Guard: ${feedback.guardName}\n` +
        `- Broken Invariant: ${feedback.failedExpr}\n` +
        `- Directive: ${feedback.directive}\n` +
        `- Action: Immediately correct the violation and regenerate.`;
    }

    return {
      system: systemRules.join("\n\n"),
      user: userPayload,
    };
  }
}
