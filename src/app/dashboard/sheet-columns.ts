const DEFAULTS: Record<string, number> = { Owner: 215, Number: 174, Phone: 174, Availability: 195, "Call Status": 130, "Called By": 130, Added: 72, "WH ID": 125, When: 185, Direction: 95, Area: 110, Sqft: 90, Rent: 155, "AI Call Details": 145, DB: 100, "Assigned To": 205, Notes: 260, Transcript: 320, Recording: 100, Address: 270, "Record ID": 110, Source: 100, Calls: 85 };

export const CALL_COLUMNS = [
  "Owner", "Number", "Availability", "Call Status", "Called By", "Added", "WH ID", "When", "Direction", "Area", "Sqft", "Rent",
  "AI Call Details", "Notes", "Transcript", "Recording", "DB", "DB Owner", "DB Type", "DB City", "DB State", "DB Sqft", "All Sources",
];
export const RAW_COLUMNS = [
  "Owner", "Phone", "Sqft", "Source", "Record ID", "Calls", "Last Status", "Last Result", "Last Called", "Transcript", "Audio", "Notes",
  "Contact", "City", "State", "Address", "Assigned To",
];
export const CALL_GROUPS = [
  { key: "call", toggle: "AI Call Details", members: ["Notes", "Transcript", "Recording"] },
  { key: "db", toggle: "DB", members: ["DB Owner", "DB Type", "DB City", "DB State", "DB Sqft", "All Sources"] },
];
export const RAW_GROUPS = [
  { key: "calls", toggle: "Calls", members: ["Last Status", "Last Result", "Last Called", "Transcript", "Audio", "Notes"] },
];
export const ASSIGNMENT_COLUMNS = ["Assignee", "Notes", "Status", "Result", "Who", "Phone", "City", "Channel", "Assigned", "In DB", "WH ID", "Brief", "Actions"];

export function defaultColumnWidth(name: string) {
  return name === 'Row' ? 32 : name === 'Select' ? 34 : DEFAULTS[name] || 125;
}

// Both the loaded table and its skeleton honour the same saved geometry.
export function readColumnPreferences(path: string, labels: string[], defaults: Record<string, number> = DEFAULTS) {
  const key = `sheet-col-widths-v6:${path}`;
  let saved: Record<string, number> = {};
  let hiddenColumns: string[] = [];
  try {
    saved = JSON.parse(localStorage.getItem(key) || "{}");
    hiddenColumns = JSON.parse(localStorage.getItem(`sheet-hidden:${path}`) || "[]");
    if (!saved || Array.isArray(saved) || typeof saved !== 'object') saved = {};
    if (!Array.isArray(hiddenColumns)) hiddenColumns = [];
    // Preserve earlier saved widths by their old column names after reordering.
    if (!Object.keys(saved).length) {
      const legacy = JSON.parse(localStorage.getItem(`sheet-col-widths-v5:${path}`) || "null");
      const oldNames = path.endsWith('/calls') ? ["When","Direction","Number","Owner","Area","Availability","Sqft","Rent","AI Call Details","Notes","Transcript","Recording","DB","DB Owner","DB Type","DB City","DB State","DB Sqft","All Sources","Call Status","Called By","Added","WH ID", ...(labels.includes('Assigned To') ? ['Assigned To'] : [])] : ["Source","Record ID","Owner","Phone","Sqft","Calls","Last Status","Last Result","Last Called","Transcript","Audio","Notes","Contact","City","State","Address","Assigned To"];
      const names = ['Row', ...(labels.includes('Select') ? ['Select'] : []), ...oldNames];
      if (Array.isArray(legacy) && legacy.length === names.length) names.forEach((name,i) => { if (Number.isFinite(legacy[i]) && legacy[i] > 0) saved[name] = legacy[i]; });
    }
  } catch { /* storage may be unavailable */ }
  const locked = new Set(['Row','Select','Owner','Number','Phone']);
  hiddenColumns = hiddenColumns.filter(name => !locked.has(name));
  return { widths: labels.map(name => Number.isFinite(saved[name]) && saved[name] >= 40 ? saved[name] : name === 'Row' ? 32 : name === 'Select' ? 34 : defaults[name] || 125), hiddenColumns };
}
