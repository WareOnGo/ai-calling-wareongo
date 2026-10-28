import { defaultColumnWidth, readColumnPreferences } from "./sheet-columns";

// On a streamed full-page load, the fallback can paint before React hydrates.
// Apply saved column geometry at that first paint as well as in the client effect.
// Only fixed selectors, finite numeric widths and fixed display values enter CSS.
export function LoadingColumnStyles({ view, labels, groups }: {
  view: "calls" | "raw"; labels: string[]; groups: { key: string; members: string[] }[];
}) {
  const config = JSON.stringify({ path: `/dashboard/${view}`, labels, groups, defaults: Object.fromEntries(labels.map(label => [label, defaultColumnWidth(label)])) });
  const id = `loading-column-styles-${view}`;
  return <>
    <style id={id} />
    <script dangerouslySetInnerHTML={{ __html: `(()=>{try{
      const config=${config};
      const read=${readColumnPreferences.toString()};
      const prefs=read(config.path,config.labels,config.defaults);
      const table='[data-loading-view="${view}"] table.sheet.resizable.loading-sheet';
      const css=config.labels.map((label,index)=>{
        const group=config.groups.find(group=>group.members.includes(label));
        const hidden=prefs.hiddenColumns.includes(label)||(group&&localStorage.getItem('sheet-groups:'+config.path+':'+group.key)!=='true');
        const column=table+' col:nth-child('+(index+1)+')';
        const cells=table+' tr>:nth-child('+(index+1)+')';
        return column+'{width:'+(hidden?0:prefs.widths[index])+'px!important;display:'+(hidden?'none':'table-column')+'!important}'+cells+'{display:'+(hidden?'none':'table-cell')+'!important}';
      }).join('');
      const carets=config.groups.filter(group=>localStorage.getItem('sheet-groups:'+config.path+':'+group.key)==='true').map(group=>table+' .'+group.key+'-toggle .grp-caret{border-left:6px solid transparent;border-right:6px solid transparent;border-top:8px solid var(--green);border-bottom:0}').join('');
      const sheet=document.getElementById('${id}').sheet;
      for(const rule of (css+carets).match(/[^}]+}/g)||[]) sheet.insertRule(rule,sheet.cssRules.length);
    }catch{}})();` }} />
  </>;
}
