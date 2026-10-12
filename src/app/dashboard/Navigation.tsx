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
  const links = [["my", "My Work"], ...(admin ? [["calls", "Call Analytics"], ["raw", "Raw Dataset"], ["assignments", "Assignments"], ["team", "Team"]] : [])];
  return <nav ref={ref} className="topnav" aria-label="Dashboard">{links.map(([slug, label]) => <Link key={slug} href={`/dashboard/${slug}`} aria-current={path === `/dashboard/${slug}` ? "page" : undefined}>{label}</Link>)}</nav>;
}
