export function publishContent(topic: string): {
  slug: string;
  summary: string;
} {
  return {
    slug: topic.toLowerCase().replaceAll(" ", "-"),
    summary: `A practical guide to ${topic}`,
  };
}
