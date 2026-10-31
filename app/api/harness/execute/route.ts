import { NextRequest, NextResponse } from "next/server";
import { HarnessVM } from "@/lib/harness-core/vm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      flowName = "SynthesizeSafetyGuard",
      skillMarkdown = "",
      apiKey = "",
      scenario = "FAIL_ONCE", // 시연을 위해 기본적으로 1회 가드 실패 후 어닐링 수렴을 보여줌
      maxRetry = 3,
    } = body;

    const vm = new HarnessVM();
    const result = await vm.runFlow(
      flowName,
      skillMarkdown,
      {
        maxRetry: Number(maxRetry) || 3,
        maxBudget: 50000,
        baseTemp: 0.7,
        scenario,
      },
      apiKey
    );

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to execute harness VM" },
      { status: 500 }
    );
  }
}
