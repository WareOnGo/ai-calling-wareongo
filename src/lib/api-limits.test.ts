import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { apiError, bigintId, jsonBody, MAX_JSON_BODY_BYTES, revision, selectedIds, uuid } from './api';
import { executionSchema } from './bolna';
import { assignmentRequestSchema } from './assignment-request';
import { dispatchSchema } from './dispatch-service';

const request = (text: string, headers?: HeadersInit) => new Request('http://localhost', {method: 'POST', body: text, headers});

describe('bounded dashboard JSON requests', () => {
  it('rejects oversized Content-Length before reading or validating', async () => {
    const req = request('{}', {'content-length': String(MAX_JSON_BODY_BYTES + 1)});
    const read = vi.spyOn(req.body!, 'getReader');
    const parse = vi.fn();
    await expect(jsonBody(req, z.unknown().transform(parse))).rejects.toMatchObject({status: 413});
    expect(read).not.toHaveBeenCalled();expect(parse).not.toHaveBeenCalled();
  });

  it.each([undefined, '1'])('bounds streamed bytes even with Content-Length %s', async length => {
    let chunks = 0, canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { chunks++;controller.enqueue(new Uint8Array(64 * 1024).fill(32)); },
      cancel() { canceled = true; },
    });
    const req = new Request('http://localhost', {method: 'POST', body, duplex: 'half', headers: length ? {'content-length': length} : undefined} as RequestInit);
    const parse = vi.fn();
    await expect(jsonBody(req, z.unknown().transform(parse))).rejects.toMatchObject({status: 413});
    expect(canceled).toBe(true);expect(chunks).toBeLessThan(20);expect(parse).not.toHaveBeenCalled();
  });

  it('keeps the supported 20,000-record allocation and dispatch requests valid', async () => {
    const ids = Array.from({length: 20_000}, () => randomUUID());
    const allocation = {entity_type: 'record', ids, assignee: 'caller@example.com', note: 'न'.repeat(10_000)};
    expect((await jsonBody(request(JSON.stringify(allocation)), assignmentRequestSchema)).ids).toEqual(ids);
    expect((await jsonBody(request(JSON.stringify({ids, intentKey: randomUUID(), confirm: true})), dispatchSchema)).ids).toEqual(ids);
  });

  it('counts UTF-8 bytes rather than characters and accepts the byte boundary', async () => {
    const text = '"' + 'x'.repeat(MAX_JSON_BODY_BYTES - 2) + '"';
    expect((await jsonBody(request(text), z.string())).length).toBe(MAX_JSON_BODY_BYTES - 2);
    await expect(jsonBody(request(JSON.stringify('न'.repeat(MAX_JSON_BODY_BYTES / 2))), z.string())).rejects.toMatchObject({status: 413});
    expect(await jsonBody(request('\ufeff{"ok":false}'), z.object({ok: z.boolean()}))).toEqual({ok: false});
  });

  it('keeps malformed JSON errors and the explicit empty inference body contract', async () => {
    for (const text of ['', '{', ' ']) await expect(jsonBody(request(text), z.unknown())).rejects.toMatchObject({status: 400});
    expect(await jsonBody(request(''), z.object({force: z.boolean().optional()}), {allowEmpty: true})).toEqual({});
  });

  it('rejects oversized constrained arrays before visiting their entries', async () => {
    const visit = vi.fn();
    const schema = z.object({tasks: z.array(z.preprocess(visit, z.object({id: bigintId, revision}).strict())).max(50)}).strict();
    const error = await jsonBody(request(JSON.stringify({tasks: Array(10_000).fill(null)})), schema).catch(e => e);
    expect(visit).not.toHaveBeenCalled();expect(error.issues).toHaveLength(1);
    const response = apiError(error);expect(response.status).toBe(400);expect((await response.text()).length).toBeLessThan(512);
  });

  it('bounds validation responses even for many valid-sized invalid entries or huge keys', async () => {
    const parsed = selectedIds.safeParse(Array(20_000).fill('invalid'));
    expect(parsed.success).toBe(false);
    const response = apiError(parsed.error);
    expect(response.status).toBe(400);expect((await response.text()).length).toBeLessThan(4500);
    const extra = z.object({}).strict().safeParse({['x'.repeat(100_000)]: true});
    expect((await apiError(extra.error).text()).length).toBeLessThan(600);
  });
});

it('keeps retained nonstandard UUIDs valid while rejecting malformed IDs', () => {
  const retained = 'A0000000-0000-0000-0000-000000000001';
  expect(uuid.parse(retained)).toBe(retained.toLowerCase());
  expect(executionSchema.parse({id: retained, status: 'completed'}).id).toBe(retained);
  expect(uuid.safeParse('not-an-id').success).toBe(false);
});
