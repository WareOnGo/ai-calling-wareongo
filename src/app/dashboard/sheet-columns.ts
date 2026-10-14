const DEFAULTS: Record<string, number> = { Contact: 240, "Contact type": 135, "AI result": 140, "AI attempts": 175, "Manual result": 150, "Manual calls": 200, "Manual notes": 200, "Legacy Called By": 130, Added: 72, "WH ID": 100, When: 170, Direction: 100, Agent: 120, Area: 120, City: 125, Sqft: 90, "Built-up sqft": 120, "Carpet sqft": 120, Rent: 155, "AI Call Details": 145, DB: 100, "Assigned To": 185, Notes: 260, Transcript: 320, Recording: 110, Address: 270, "Record ID": 120, Source: 100 };

export const CALL_COLUMNS = [
  "Contact", "When", "Direction", "Agent",
  "AI result", "AI attempts", "AI Call Details", "Notes", "Transcript", "Recording",
  "Assigned To", "Manual result", "Manual notes", "Added", "WH ID", "Legacy Called By",
  "Source city", "Area", "Built-up sqft", "Carpet sqft", "Rent", "DB", "DB Owner", "DB Type", "DB City", "DB State", "DB Sqft", "All Sources",
];
export function callColumns(isAdmin: boolean) {
  return isAdmin ? CALL_COLUMNS : CALL_COLUMNS.filter(name => name !== "Assigned To");
}
export const RAW_COLUMNS = [
  "Contact", "Contact type", "City", "State", "Address", "Sqft", "Source", "Record ID",
  "AI attempts", "Last Status", "Last Result", "Last Called", "Transcript", "Audio", "Notes",
  "Assigned To", "Manual calls",
];
export const ASSIGNMENT_COLUMNS = [
  "Contact", "City", "Channel", "Assignee", "Assigned", "Status", "Brief",
  "AI result", "AI attempts", "Manual result", "Notes", "In DB", "WH ID", "Actions",
];
export const ASSIGNMENT_WIDTHS: Record<string, number> = {
  Contact: 240, City: 125, Channel: 110, Assignee: 170, Assigned: 115,
  Status: 88, Brief: 245, "AI result": 115, "AI attempts": 175, "Manual result": 125, Notes: 195,
  "In DB": 80, "WH ID": 110, Actions: 100,
};

export function defaultColumnWidth(name: string) {
  return name === 'Row' ? 32 : name === 'Select' ? 34 : DEFAULTS[name] || 125;
}

// Both the loaded table and its skeleton honour the same saved geometry.
// Keep this function self-contained: LoadingColumnStyles serializes it for first paint.
export function readColumnPreferences(path: string, labels: string[], defaults: Record<string, number> = path.endsWith('/assignments') ? ASSIGNMENT_WIDTHS : DEFAULTS) {
  const primary = path.endsWith('/calls')
    ? ['Contact', 'AI result', 'AI attempts', 'Assigned To', 'Manual result', 'Manual notes', 'Added', 'WH ID']
    : path.endsWith('/raw')
      ? ['Contact', 'City', 'Sqft', 'Source', 'AI attempts', 'Assigned To', 'Manual calls']
      : ['Contact', 'Assignee', 'Status', 'AI result', 'AI attempts', 'Manual result', 'Notes', 'Actions'];
  let hiddenColumns = labels.filter(name => !primary.includes(name));
  try {
    // The new record view starts with useful defaults. Spreadsheet widths and
    // expanded groups must not recreate the old wall of columns after migration.
    const current = JSON.parse(localStorage.getItem(`dashboard-hidden-v1:${path}`) || 'null');
    if (Array.isArray(current)) {
      // Raw Dataset used “Contact” for owner/broker type before identity cells
      // were combined. Preserve that preference without hiding the new card.
      hiddenColumns = current.map(name => path.endsWith('/raw') && name === 'Contact' ? 'Contact type' : name);
    }
  } catch { /* Storage is optional; defaults still work. */ }
  const locked = new Set(['Row','Select','Contact','Assignee','Actions']);
  hiddenColumns = hiddenColumns.filter(name => typeof name === 'string' && labels.includes(name) && !locked.has(name));
  const widths = path.endsWith('/calls') ? { ...defaults, Contact: 240, "AI result": 125, "Assigned To": 155, "Manual notes": 185 } : defaults;
  return { widths: labels.map(name => name === 'Row' ? 32 : name === 'Select' ? 40 : widths[name] || 125), hiddenColumns };
}
