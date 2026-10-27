import { describe,it,expect } from "vitest";
import { filterValues,searchValues,searchQuery,categoryWhere } from "./filter-values";
describe("multi-value filter contract",()=>{
  it("round-trips repeated keys without dropping existing scalar links",()=>{
    const values=searchValues(new URLSearchParams('last_result=Available&last_result=Unclear&city=Delhi&page=8'));
    expect(values.last_result).toEqual(['Available','Unclear']);expect(values.city).toBe('Delhi');
    expect(searchQuery(values,['page']).toString()).toBe('last_result=Available&last_result=Unclear&city=Delhi');
  });
  it("removes empty and duplicate choices while preserving explicit unknown values for validation",()=>{
    expect(filterValues(['Available','  ','Available','Unclear'])).toEqual(['Available','Unclear']);
    expect(filterValues(undefined)).toEqual([]);
  });
  it("uses OR within a category and bound values, including no-result",()=>{
    const params:unknown[]=[];expect(categoryWhere('outcome',['Available','none'],params,'none')).toBe('(outcome = any($1::text[]) or outcome is null)');
    expect(params).toEqual([['Available']]);
    expect(categoryWhere('outcome',[],params)).toBeNull();
  });
});
