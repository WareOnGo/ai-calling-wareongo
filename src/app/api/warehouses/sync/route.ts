import {NextResponse} from 'next/server';
import {workerAuthorized} from '@/lib/api';
import {runWarehouseSync, warehouseSyncStatus} from '@/lib/warehouse-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Credentials belong in the Authorization header, never the URL/query log.
const authorized = (req: Request) => !!req.headers.get('authorization')?.startsWith('Bearer ') && workerAuthorized(req);
const response = (body: unknown, status = 200) => NextResponse.json(body, {status, headers: {'Cache-Control': 'no-store'}});

export async function POST(req: Request) {
  if (!authorized(req)) return response({error: 'unauthorized'}, 401);
  try {
    const result = await runWarehouseSync();
    return response(result, result.status === 'failed' ? 503 : 200);
  } catch {
    return response({error: 'Warehouse sync unavailable'}, 503);
  }
}

export async function GET(req: Request) {
  if (!authorized(req)) return response({error: 'unauthorized'}, 401);
  try { return response(await warehouseSyncStatus()); }
  catch { return response({error: 'Warehouse sync status unavailable'}, 503); }
}
