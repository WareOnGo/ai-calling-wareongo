import {NextRequest,NextResponse} from 'next/server';
import {getCurrentAdmin} from '@/lib/auth';
import {apiError} from '@/lib/api';
import {csvResponse} from '@/lib/export';
import {parseTeamFilters,teamDetailExport,type TeamDetail} from '@/lib/team-report';
import {manualEvidenceLabel} from '@/lib/manual-dispositions';
export async function GET(req:NextRequest){const user=await getCurrentAdmin();if(!user)return NextResponse.json({error:'forbidden'},{status:403});try{
 const filters=parseTeamFilters(Object.fromEntries(req.nextUrl.searchParams));
 const keys=['metric','assignee','assignment_id','event_id','occurred_at','detail','duration_seconds','entity_type','entity_id','subject','current_state'] as const;
 return csvResponse<TeamDetail>(teamDetailExport(user,filters),keys.map(key=>({label:key,get:r=>key==='detail'?manualEvidenceLabel(r.detail):r[key]})),`bolna-team-${filters.metric}.csv`);
}catch(error){return apiError(error);}}
