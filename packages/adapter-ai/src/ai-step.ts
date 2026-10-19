import type { AiAdapter, AiFlowContext, AiResponse, AiStepDefinition } from "./types.js";

export function runAiStep<T>(
  context: AiFlowContext,
  adapter: AiAdapter,
  definition: AiStepDefinition<T>,
): Promise<AiResponse<T>> {
  const { request } = definition;
  return context.step(
    {
      id: definition.id,
      ...(definition.name === undefined ? {} : { name: definition.name }),
      kind: "ai",
      input: request,
      metadata: {
        ...(request.metadata ?? {}),
        provider: adapter.provider,
        adapterMode: adapter.mode,
        model: request.model,
        ...(request.prompt === undefined ? {} : { prompt: request.prompt }),
        ...(request.messages === undefined ? {} : { messages: request.messages }),
        ...(request.tools === undefined ? {} : { tools: request.tools }),
        ...(request.responseSchema === undefined
          ? {}
          : { responseSchema: request.responseSchema }),
      },
      capabilities: adapter.capabilities,
      ...(definition.evaluators === undefined
        ? {}
        : { evaluators: definition.evaluators }),
    },
    () => adapter.execute<T>(request),
  );
}
