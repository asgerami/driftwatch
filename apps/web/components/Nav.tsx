"use client";

import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Changes", match: (p: string) => p === "/" },
  { href: "/providers", label: "APIs", match: (p: string) => p === "/providers" || p.startsWith("/apis/") },
  { href: "/method", label: "Method", match: (p: string) => p === "/method" },
];

/** The masthead's links, marking the page the reader is on. */
export function Nav() {
  const pathname = usePathname() ?? "/";
  const links = LINKS.map((link) => (
    <a key={link.href} href={link.href} aria-current={link.match(pathname) ? "page" : undefined}>
      {link.label}
    </a>
  ));
  return (
    <nav className="nav" aria-label="Main">
      {links}
      <details className="nav-menu">
        <summary>Menu</summary>
        <div className="nav-menu-panel">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} aria-current={link.match(pathname) ? "page" : undefined}>
              {link.label}
            </a>
          ))}
          <a href="/rss.xml">RSS feed</a>
        </div>
      </details>
      <a className="btn" href="/watch" aria-current={pathname === "/watch" ? "page" : undefined}>
        Watch my repo
      </a>
    </nav>
  );
}
