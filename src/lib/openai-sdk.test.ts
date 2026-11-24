import { afterEach, expect, it, vi } from 'vitest';
import { EMPTY_INFERENCE, inferCall, inferDistrict } from './openai';

const cache = globalThis as unknown as {__openai?: unknown};
afterEach(() => { delete cache.__openai;vi.unstubAllGlobals();vi.unstubAllEnvs(); });

it('uses the upgraded SDK for the existing structured-output requests', async () => {
  delete cache.__openai;vi.stubEnv('OPENAI_API_KEY', 'sk-local-test-only');
  const requests: Record<string, any>[] = [];
  const inference = {...EMPTY_INFERENCE, availability: 'Available', built_up_area_sqft: '9000', confidence: 'High'};
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init), body = await req.json();requests.push(body);
    expect(new URL(req.url).pathname).toBe('/v1/chat/completions');
    const content = body.response_format.json_schema.name === 'property_inference' ? inference : {district: 'Pune', confidence: 'High'};
    return new Response(JSON.stringify({id: 'local', object: 'chat.completion', choices: [{index: 0, finish_reason: 'stop', message: {role: 'assistant', content: JSON.stringify(content)}}]}), {headers: {'content-type': 'application/json'}});
  }));
  expect(await inferCall('The owner confirmed a 9,000 sqft warehouse is available.')).toEqual(inference);
  expect(await inferDistrict('The property is in Pune.', 'Pune')).toEqual({district: 'Pune', confidence: 'High'});
  expect(requests).toHaveLength(2);
  for (const body of requests) expect(body.response_format).toMatchObject({type: 'json_schema', json_schema: {strict: true}});
});

it('preserves provider errors and does not retry a failed inference', async () => {
  delete cache.__openai;vi.stubEnv('OPENAI_API_KEY', 'sk-local-test-only');
  const fetch = vi.fn(async () => new Response(JSON.stringify({error: {message: 'Rate limited', type: 'rate_limit_error'}}), {status: 429, headers: {'content-type': 'application/json'}}));
  vi.stubGlobal('fetch', fetch);
  await expect(inferCall('A valid transcript that needs inference')).rejects.toMatchObject({status: 429});
  expect(fetch).toHaveBeenCalledTimes(1);
});
