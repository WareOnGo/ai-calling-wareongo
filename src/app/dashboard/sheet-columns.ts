const DEFAULTS: Record<string, number> = { Owner: 200, Number: 180, Phone: 176, "AI result": 140, "AI attempts": 175, "Manual result": 150, "Manual calls": 200, "Manual notes": 200, "Legacy Called By": 130, Added: 72, "WH ID": 100, When: 170, Direction: 100, Agent: 120, Area: 120, City: 125, Sqft: 90, "Built-up sqft": 120, "Carpet sqft": 120, Rent: 155, "AI Call Details": 145, DB: 100, "Assigned To": 185, Notes: 260, Transcript: 320, Recording: 110, Address: 270, "Record ID": 120, Source: 100 };

export const CALL_COLUMNS = [
  "Owner", "Number", "When", "Direction", "Agent",
  "AI result", "AI attempts", "AI Call Details", "Notes", "Transcript", "Recording",
  "Assigned To", "Manual result", "Manual notes", "Added", "WH ID", "Legacy Called By",
  "Source city", "Area", "Built-up sqft", "Carpet sqft", "Rent", "DB", "DB Owner", "DB Type", "DB City", "DB State", "DB Sqft", "All Sources",
];
export function callColumns(isAdmin: boolean) {
  return isAdmin ? CALL_COLUMNS : CALL_COLUMNS.filter(name => name !== "Assigned To");
}
export const RAW_COLUMNS = [
  "Owner", "Phone", "Contact", "City", "State", "Address", "Sqft", "Source", "Record ID",
  "AI attempts", "Last Status", "Last Result", "Last Called", "Transcript", "Audio", "Notes",
  "Assigned To", "Manual calls",
];
export const ASSIGNMENT_COLUMNS = [
  "Who", "Phone", "City", "Channel", "Assignee", "Assigned", "Status", "Brief",
  "AI result", "Manual result", "Notes", "In DB", "WH ID", "Actions",
];
export const ASSIGNMENT_WIDTHS: Record<string, number> = {
  Who: 190, Phone: 176, City: 125, Channel: 110, Assignee: 180, Assigned: 115,
  Status: 120, Brief: 245, "AI result": 140, "Manual result": 140, Notes: 225,
  "In DB": 80, "WH ID": 110, Actions: 145,
};

export function defaultColumnWidth(name: string) {
  return name === 'Row' ? 32 : name === 'Select' ? 34 : DEFAULTS[name] || 125;
}

// Both the loaded table and its skeleton honour the same saved geometry.
// Keep this function self-contained: LoadingColumnStyles serializes it for first paint.
export function readColumnPreferences(path: string, labels: string[], defaults: Record<string, number> = path.endsWith('/assignments') ? ASSIGNMENT_WIDTHS : DEFAULTS) {
  const primary = path.endsWith('/calls')
    ? ['Owner', 'Number', 'AI result', 'AI attempts', 'Assigned To', 'Manual result', 'Manual notes', 'Added', 'WH ID']
    : path.endsWith('/raw')
      ? ['Owner', 'Phone', 'City', 'Sqft', 'Source', 'AI attempts', 'Assigned To', 'Manual calls']
      : ['Who', 'Phone', 'Assignee', 'Status', 'AI result', 'Manual result', 'Notes', 'Actions'];
  let hiddenColumns = labels.filter(name => !primary.includes(name));
  try {
    // The new record view starts with useful defaults. Spreadsheet widths and
    // expanded groups must not recreate the old wall of columns after migration.
    const current = JSON.parse(localStorage.getItem(`dashboard-hidden-v1:${path}`) || 'null');
    if (Array.isArray(current)) hiddenColumns = current;
  } catch { /* Storage is optional; defaults still work. */ }
  const locked = new Set(['Row','Select','Owner','Number','Phone','Assignee','Who','Actions']);
  hiddenColumns = hiddenColumns.filter(name => typeof name === 'string' && !locked.has(name));
  return { widths: labels.map(name => name === 'Row' ? 32 : name === 'Select' ? 40 : path.endsWith('/calls') && name === 'AI attempts' ? 120 : path.endsWith('/calls') && name === 'Assigned To' ? 160 : defaults[name] || 125), hiddenColumns };
}
