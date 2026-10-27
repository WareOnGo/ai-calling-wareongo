/** Compare the same non-empty values that are sent in the filter URL.
 * Order and empty controls do not change the meaning of a filter draft. */
export function filterFormSnapshot(form: HTMLFormElement): string {
  const values: [string, string][] = [];
  new FormData(form).forEach((value, key) => {
    const text = String(value).trim();
    if (text) values.push([key, text]);
  });
  values.sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  return JSON.stringify(values);
}

/** Validate the draft, including both ends changed in the same Apply. */
export function filterRangeError(form: HTMLFormElement): {field:string;message:string} | undefined {
  const values = new FormData(form);
  for (const [from,to,label] of [["date_from","date_to","Date"],["completed_from","completed_to","Completion date"]]) {
    const start=String(values.get(from)||""),end=String(values.get(to)||"");
    if(start && end && start>end) return {field:to,message:`${label}: the end must be on or after the start.`};
  }
  const min=values.get('min_area'),max=values.get('max_area');
  if(min!==null && min!=='' && max!==null && max!=='' && Number(min)>Number(max)) return {field:'max_area',message:'Maximum square feet must be at least the minimum.'};
}
