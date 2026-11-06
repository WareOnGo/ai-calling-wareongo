"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export function Navigation({ admin }: { admin: boolean }) {
  const path = usePathname();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current!;
    const reveal = () => {const active = nav.querySelector<HTMLElement>('[aria-current="page"]');if(active && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;};
    reveal(); const observer = new ResizeObserver(reveal);observer.observe(nav);return () => observer.disconnect();
  }, [path]);
  // A tag marks a page still in trial; it is part of the link's name, so screen readers hear it too.
  const links: [slug: string, label: string, tag?: string][] = [["my", "My Work"], ["board", "Board", "Beta"], ...(admin ? [["calls", "AI Calls"], ["raw", "Raw Dataset"], ["assignments", "Assignments"], ["batches", "Batches"], ["team", "Team"]] as [string, string][] : [])];
  return <nav ref={ref} className="topnav" aria-label="Dashboard">{links.map(([slug, label, tag]) => <Link key={slug} href={`/dashboard/${slug}`} aria-current={(path === `/dashboard/${slug}` || path.startsWith(`/dashboard/${slug}/`)) ? "page" : undefined}>
    {label}{tag && <> <span className="nav-tag">{tag}</span></>}
  </Link>)}</nav>;
}
