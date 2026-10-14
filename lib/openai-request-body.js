// Preserve the non-reasoning behavior and sampling settings of the GPT-4o flow.
export function buildOpenAiRequestBody(input) {
 return {
  ...input,
  ...(input.model === 'gpt-6-luna' ? { reasoning_effort: 'none' } : {}),
  max_completion_tokens: 4096,
  service_tier: 'default'
 };
}
