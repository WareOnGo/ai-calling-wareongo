import { NextRequest, NextResponse } from 'next/server';
import { getCurrentAdmin } from '@/lib/auth';
import { apiError, ApiError, uuid } from '@/lib/api';
import { batchCatalogVersion, batchDetailVersion } from '@/lib/batch-version';
import { batchListSchema, batchMemberFiltersSchema, batchMembers, batchProgress, getBatch, listBatches } from '@/lib/batch-browser';
import { firstValue, searchValues } from '@/lib/filter-values';
import { listUsers } from '@/lib/users';

export async function GET(req: NextRequest) {
  try {
    const viewer=await getCurrentAdmin();
    if (!viewer) return NextResponse.json({error:'forbidden'},{status:403});
    const kind=req.nextUrl.searchParams.get('kind');
    if(kind!=='ai' && kind!=='manual')throw new ApiError(400,'Invalid batch kind');
    const id=req.nextUrl.searchParams.get('id')||undefined;
    if(id && !(kind==='manual' && id==='legacy'))uuid.parse(id);
    const sp=req.nextUrl.searchParams,filters=searchValues(new URLSearchParams([...sp].filter(([,value])=>value)));
    const page=Number(firstValue(filters.page)||1);
    let version:string;
    if(id) {
      const parsed=batchMemberFiltersSchema.parse(filters);
      let batch;
      try { batch=await getBatch(viewer,kind,id); }
      catch(error) { if(!(error instanceof ApiError && error.status===404))throw error; }
      // A deleted batch must invalidate an already-open detail page too.
      version=batch?batchDetailVersion(batch,await batchMembers(viewer,batch,firstValue(filters.metric)||'all',page,parsed)):batchDetailVersion(null);
    } else {
      const parsed=batchListSchema.parse({...filters,kind});
      const [data,people]=await Promise.all([listBatches(viewer,parsed,page),listUsers()]);
      version=batchCatalogVersion(data,await batchProgress(data.rows),people);
    }
    return NextResponse.json({version},{headers:{'Cache-Control':'no-store'}});
  } catch(error) { return apiError(error); }
}
