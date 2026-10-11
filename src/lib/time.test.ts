import {afterEach,expect,it,vi} from 'vitest';
import {elapsedTime,providerTimestamp} from './time';
import {dateTime} from './display';
import {normalize} from './bolna';
afterEach(()=>vi.unstubAllEnvs());
it.each(['UTC','Asia/Kolkata','America/New_York'])('keeps unqualified provider timestamps in UTC on a %s host',zone=>{
 vi.stubEnv('TZ',zone);
 expect(providerTimestamp('2026-07-08T08:30:12')).toBe('2026-07-08T08:30:12.000Z');
 expect(normalize({id:'00000000-0000-4000-8000-000000000001',status:'completed',created_at:'2026-07-08 08:30:12'}).call_created_at).toBe('2026-07-08T08:30:12.000Z');
 expect(dateTime('2026-07-08T08:30:12')).toContain('2:00 pm IST');
 expect(dateTime('2026-07-08 08:30:12+00')).toBe(dateTime('2026-07-08T14:00:12+05:30'));
});
it.each(['2026-02-30T08:30:12','2026-13-01T00:00:00','2026-07-08T25:00:00','yesterday','',null])('keeps invalid or missing time %s unknown',value=>{
 expect(providerTimestamp(value)).toBeNull();expect(dateTime(value)).toBe('—');
});
it('formats long and short intervals without ambiguous grouped seconds',()=>{
 expect(elapsedTime(604800)).toBe('7 days');expect(elapsedTime(90061)).toBe('1 day 1 hour 1 minute 1 second');
 expect(elapsedTime(90)).toBe('1 minute 30 seconds');expect(elapsedTime(0)).toBe('0 seconds');
});
