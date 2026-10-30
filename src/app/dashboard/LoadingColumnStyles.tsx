import { defaultColumnWidth, readColumnPreferences } from "./sheet-columns";

// On a streamed full-page load, the fallback can paint before React hydrates.
// Apply saved column geometry at that first paint as well as in the client effect.
// Only fixed selectors, finite numeric widths and fixed display values enter CSS.
export function LoadingColumnStyles({ view, labels }: {
  view: "calls" | "raw"; labels: string[];
}) {
  const config = JSON.stringify({ path: `/dashboard/${view}`, labels, defaults: Object.fromEntries(labels.map(label => [label, defaultColumnWidth(label)])) });
  const id = `loading-column-styles-${view}`;
  return <script dangerouslySetInnerHTML={{ __html: `(()=>{try{
      const config=${config};
      const read=${readColumnPreferences.toString()};
      const prefs=read(config.path,config.labels,config.defaults);
      const table='[data-loading-view="${view}"] table.sheet.resizable.loading-sheet';
      const css=config.labels.map((label,index)=>{
        const hidden=label==='Row'||prefs.hiddenColumns.includes(label);
        const column=table+' col:nth-child('+(index+1)+')';
        const cells=table+' tr>:nth-child('+(index+1)+')';
        return column+'{width:'+(hidden?0:prefs.widths[index])+'px!important;display:'+(hidden?'none':'table-column')+'!important}'+cells+'{display:'+(hidden?'none':'table-cell')+'!important}';
      }).join('');
      // Keep the stylesheet outside streamed containers: moving a style element
      // recreates its sheet and discards rules inserted only through CSSOM.
      let style=document.getElementById('${id}');
      if(!style){style=document.createElement('style');style.id='${id}';document.head.appendChild(style);}
      style.textContent=css;
    }catch{}})();` }} />
}
