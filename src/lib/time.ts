/** Provider timestamps without an explicit offset use UTC, never the host timezone. */
export function providerTimestamp(value:string|null|undefined):string|null {
  if(!value)return null;
  const match=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(value);
  if(!match)return null;
  const [,year,month,day,hour,minute,second,fraction='',offset='Z']=match;
  const days=new Date(Date.UTC(Number(year),Number(month),0)).getUTCDate();
  if(Number(month)<1||Number(month)>12||Number(day)<1||Number(day)>days||Number(hour)>23||Number(minute)>59||Number(second)>59)return null;
  const zone=/^[+-]\d{2}$/.test(offset)?offset+':00':offset;
  const milliseconds=Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}${zone}`);
  return Number.isFinite(milliseconds)?new Date(milliseconds).toISOString():null;
}

export function elapsedTime(value:number):string {
  if(!Number.isFinite(value)||value<0)return 'Unknown interval';
  let seconds=Math.round(value);
  const parts:string[]=[];
  for(const [size,label] of [[86400,'day'],[3600,'hour'],[60,'minute'],[1,'second']] as const){
    const count=Math.floor(seconds/size);seconds%=size;
    if(count)parts.push(`${count.toLocaleString('en-IN')} ${label}${count===1?'':'s'}`);
  }
  return parts.join(' ')||'0 seconds';
}
