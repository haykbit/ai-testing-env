import {
  defineFlow,
  defineProject,
  defineScenario,
} from "ai-testing-env";
import { publishContent } from "../src/content.js";

const publish = defineFlow({
  id: "publish-content",
  async execute(context, input: { topic: string }) {
    return context.step(
      {
        id: "publish",
        kind: "code",
        input,
        evaluators: [
          {
            name: "summary mentions topic",
            evaluate: ({ value }) => ({
              name: "summary mentions topic",
              passed: value.summary.toLowerCase().includes(input.topic.toLowerCase()),
            }),
          },
        ],
      },
      () => publishContent(input.topic),
    );
  },
  evaluators: [
    {
      name: "slug is URL-safe",
      evaluate: ({ value }) => ({
        name: "slug is URL-safe",
        passed: /^[a-z0-9-]+$/.test(value.slug),
      }),
    },
  ],
});

const happyPath = defineScenario({
  id: "publish-happy-path",
  flowId: publish.id,
  input: { topic: "AI testing" },
  tags: ["mocked", "smoke"],
  profileId: "mocked",
});

export default defineProject({
  id: "basic-backend",
  flows: [publish],
  scenarios: [happyPath],
});
