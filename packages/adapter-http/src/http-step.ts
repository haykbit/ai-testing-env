import { defaultHeaderAllowlist, selectHeaders } from "./adapters.js";
import type {
  HttpAdapter,
  HttpFlowContext,
  HttpResponse,
  HttpStepDefinition,
} from "./types.js";

export function runHttpStep<T>(
  context: HttpFlowContext,
  adapter: HttpAdapter,
  definition: HttpStepDefinition<T>,
): Promise<HttpResponse<T>> {
  const allowlist = definition.headerAllowlist ?? defaultHeaderAllowlist;
  const input = {
    method: definition.request.method,
    url: definition.request.url,
    headers: selectHeaders(definition.request.headers, allowlist),
    ...(definition.request.body === undefined
      ? {}
      : { body: definition.request.body }),
  };
  return context.step(
    {
      id: definition.id,
      ...(definition.name === undefined ? {} : { name: definition.name }),
      kind: "http",
      input,
      metadata: {
        adapterMode: adapter.mode,
        method: definition.request.method,
        url: definition.request.url,
        requestHeaders: input.headers,
      },
      capabilities: adapter.capabilities,
      ...(definition.evaluators === undefined
        ? {}
        : { evaluators: definition.evaluators }),
    },
    () => adapter.execute<T>(definition.request),
  );
}
