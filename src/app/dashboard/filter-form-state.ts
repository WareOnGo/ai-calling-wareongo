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
