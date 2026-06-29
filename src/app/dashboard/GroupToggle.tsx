"use client";

// Green clickable group header. Clicking toggles a `${group}-collapsed` class on
// the table; CSS then shows/hides that group's `.${group}-col` columns.
export function GroupToggle({ group, label }: { group: string; label: string }) {
  return (
    <th
      className={`${group}-toggle grp-toggle grp-toggle-head`}
      title="Show / hide these columns"
      onClick={(e) => e.currentTarget.closest("table")?.classList.toggle(`${group}-collapsed`)}
    >
      <span className="grp-head-inner">
        {label}<span className="grp-caret" />
      </span>
    </th>
  );
}
