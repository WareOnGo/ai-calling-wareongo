"use client";
import { usePathname } from "next/navigation";
import { GridLoading } from "./GridLoading";
import { TeamLoading } from "./team/TeamLoading";
import { BatchLoading } from "./batches/BatchLoading";

// This fallback is inherited by nested routes before their own boundary loads.
// Never show the overview cards while another dashboard page is loading.
export default function Loading() {
  const path = usePathname();
  if (path.startsWith("/dashboard/batches")) return <BatchLoading/>;
  if (path.startsWith("/dashboard/team/access")) return <TeamLoading view="access"/>;
  const section = path.split("/")[2];
  if (section === "calls" || section === "raw" || section === "my" || section === "assignments" || section === "team") return <GridLoading view={section}/>;
  if (path === "/dashboard") return <GridLoading view="home"/>;
  return <p role="status" className="page-title">Loading page…</p>;
}
