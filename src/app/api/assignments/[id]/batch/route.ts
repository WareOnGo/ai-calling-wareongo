import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentAdmin } from '@/lib/auth';
import { apiError, bigintId } from '@/lib/api';
import { assignmentBatchPreview } from '@/lib/assignment-batch-preview';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getCurrentAdmin();
  if (!viewer) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    const id = bigintId.parse((await params).id);
    const page = z.coerce.number().int().min(1).max(1000000).parse(req.nextUrl.searchParams.get('page') || '1');
    return NextResponse.json(await assignmentBatchPreview(viewer, id, page));
  } catch (error) { return apiError(error); }
}
