const labels:Record<string,string>={completed:"Completed",canceled:"Canceled",scheduled:"Scheduled",uncertain:"Needs verification",creating:"Creating",sending:"Sending",scheduling:"Scheduling",failed:"Failed",stubbed:"Test batch",open:"Open",closed:"Closed",legacy:"Legacy"};
export function BatchStatus({state,received=0,total=0}:{state:string;received?:number;total?:number}){
  const active=['scheduled','uncertain'].includes(state),label=active&&received>0?(received>=total?'Awaiting confirmation':'Receiving results'):(labels[state]||state);
  const tone=['completed','closed'].includes(state)?'done':['failed','uncertain'].includes(state)?'unclear':['canceled','legacy','stubbed'].includes(state)?'dropped':'open';
  return <span className={`pill pill-${tone} batch-status`}>{label}</span>;
}
