import test from 'node:test';
import assert from 'node:assert/strict';
import { aiPrices, aiCost, aiReservation } from '../lib/ai-budget-policy.js';
import { buildOpenAiRequestBody } from '../lib/openai-request-body.js';
const prices = aiPrices('gpt-6-luna', {});
const usage = (input, output, cached = 0, written = 0) => ({ prompt_tokens: input, completion_tokens: output, prompt_tokens_details: { cached_tokens: cached, cache_write_tokens: written } });

test('Luna requests preserve sampling and strict output contracts without reasoning tokens', () => {
 const schema = { type: 'json_schema', json_schema: { name: 'test', strict: true, schema: { type: 'object' } } };
 const input = { model: 'gpt-6-luna', temperature: 0.1, messages: [{ role: 'user', content: 'Test' }], response_format: schema };
 const body = buildOpenAiRequestBody(input);
 assert.equal(body.reasoning_effort, 'none');
 assert.equal(body.max_completion_tokens, 4096);
 assert.equal(body.service_tier, 'default');
 assert.deepEqual(body.response_format, schema);
 assert.equal(body.temperature, input.temperature);
 assert.equal(input.reasoning_effort, undefined);
 assert.equal(buildOpenAiRequestBody({ model: 'gpt-4o-mini' }).reasoning_effort, undefined);
});
test('Luna bills ordinary input, cache reads, cache writes and output separately', () => {
 assert.equal(aiCost(usage(10000, 1000, 2000, 3000), prices).usd, 0.001395);
 assert.equal(aiCost(usage(10000, 1000), prices).usd, 0.0015);
});
test('long-context rates apply to the full request only above the threshold', () => {
 assert.equal(aiCost(usage(272000, 1000), prices).usd, 0.0277);
 assert.equal(aiCost(usage(300000, 1000, 100000, 100000), prices).usd, 0.04775);
});
test('invalid or inconsistent usage cannot undercharge the allowance', () => {
 for (const value of [undefined, usage(100, 10, 60, 50), usage(100, 10, -1), usage(100, 10, 0, NaN)]) assert.equal(aiCost(value, prices), null);
});
test('reservation covers worst-case cache writes and long-context pricing', () => {
 for (const length of [1000, 300000]) {
  const body = buildOpenAiRequestBody({ model: 'gpt-6-luna', messages: [{ role: 'user', content: 'x'.repeat(length) }] });
  const input = Buffer.byteLength(JSON.stringify(body), 'utf8') + 1024;
  const actual = aiCost(usage(input, body.max_completion_tokens, 0, input), prices).usd;
  assert.ok(aiReservation(body, prices) >= actual);
 }
});
test('custom rates remain explicit and account for Luna cache-write premiums', () => {
 assert.throws(() => aiPrices('gpt-6-luna', { OPENAI_INPUT_USD_PER_MILLION: '0.1' }));
 assert.throws(() => aiPrices('unknown-model', {}));
 const custom = aiPrices('gpt-6-luna', { OPENAI_INPUT_USD_PER_MILLION: '1', OPENAI_CACHED_INPUT_USD_PER_MILLION: '0.1', OPENAI_OUTPUT_USD_PER_MILLION: '5' });
 assert.equal(aiCost(usage(10000, 1000, 2000, 3000), custom).usd, 0.01395);
});
test('legacy override billing remains available during the transition', () => {
 assert.equal(aiCost(usage(10000, 1000, 2000), aiPrices('gpt-4o-mini', {})).usd, 0.00195);
});
