export type FilterValue=string|string[]|undefined;
export type SearchValues=Record<string,FilterValue>;
export const filterValues=(value:FilterValue):string[]=>[...new Set((Array.isArray(value)?value:value?[value]:[]).map(v=>v.trim()).filter(Boolean))];
export const firstValue=(value:FilterValue)=>filterValues(value)[0];
export function searchValues(params:URLSearchParams):SearchValues {
  return Object.fromEntries([...new Set(params.keys())].map(key=>{const values=params.getAll(key);return [key,values.length===1?values[0]:values];}));
}
export function searchQuery(values:SearchValues,omit:string[]=[]):URLSearchParams {
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries(values))if(!omit.includes(key))for(const selected of filterValues(value))params.append(key,selected);
  return params;
}
/** Parameters are values only; every SQL expression is a source-code constant. */
export function categoryWhere(expression:string,value:FilterValue,params:unknown[],nullValue?:string):string|null {
  const values=filterValues(value);if(!values.length)return null;
  const includesNull=!!nullValue&&values.includes(nullValue),concrete=values.filter(v=>v!==nullValue);
  const terms:string[]=[];
  if(concrete.length){params.push(concrete);terms.push(`${expression} = any($${params.length}::text[])`);}
  if(includesNull)terms.push(`${expression} is null`);
  return `(${terms.join(" or ")})`;
}

// Source-name aliases, not substring matching between unrelated places.
export const CITY_ALIASES=[
 ['bangalore','bengaluru'],['bombay','mumbai'],['gurgaon','gurugram'],
 ['calcutta','kolkata'],['madras','chennai'],['poona','pune'],['baroda','vadodara'],
 ['trivandrum','thiruvananthapuram'],['cochin','kochi'],['mysore','mysuru'],
 ['mangalore','mangaluru'],['pondicherry','puducherry'],['calicut','kozhikode'],
] as const;
export const normalizeCity=(value:string)=>value.toLowerCase().replace(/[.,]/g,' ').trim().replace(/\s+/g,' ').replace(/ (urban|city|district)$/,'');
export function cityWhere(expression:string,value:string,params:unknown[]):string {
 const normalized=normalizeCity(value);
 const aliases=CITY_ALIASES.find(group=>(group as readonly string[]).includes(normalized))||[normalized];
 params.push(aliases);
 return `regexp_replace(regexp_replace(trim(translate(lower(${expression}), '.,', '  ')), '[[:space:]]+', ' ', 'g'), ' (urban|city|district)$', '') = any($${params.length}::text[])`;
}
