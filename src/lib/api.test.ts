import {afterEach, describe, expect, it, vi} from 'vitest';
import {apiError} from './api';

afterEach(() => vi.restoreAllMocks());

describe('shared-schema database conflicts', () => {
  it('returns a useful warehouse conflict without exposing database error details', async () => {
    const response = apiError({code: '23514', message: 'Private database message',
      detail: JSON.stringify({code: 'WAREHOUSE_ALREADY_ADDED', field: 'phone', message: 'Private contact details'})});
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({code: 'WAREHOUSE_ALREADY_ADDED', error: expect.stringContaining('warehouse')});
    expect(JSON.stringify(body)).not.toContain('Private');
  });

  it.each(['not JSON', 'null', '[]', '{"code":"UNRECOGNIZED_CONSTRAINT","message":"Private details"}'])(
    'keeps an unrecognized check violation private: %s', async detail => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const response = apiError({code: '23514', detail});
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({error: 'Request failed. Please retry.'});
    },
  );

  it('requires a check violation before interpreting structured warehouse details', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = apiError({code: 'XX000', detail: '{"code":"WAREHOUSE_ALREADY_ADDED"}'});
    expect(response.status).toBe(500);
  });
});
