"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Lang } from "@/lib/i18n";

/** The same page in the other language. */
export function LangSwitch({ lang, label, other }: { lang: Lang; label: string; other: string }) {
  const path = usePathname() ?? `/${lang}/`;
  const target: Lang = lang === "en" ? "fr" : "en";
  const href = path.replace(/^\/(en|fr)(?=\/|$)/, `/${target}`);
  return (
    <Link className="nav-lang" href={href.endsWith("/") ? href : `${href}/`} hrefLang={target} lang={target} aria-label={`${label}: ${other}`}>
      <span aria-hidden="true">{lang.toUpperCase()}</span>
      <span className="nav-lang-sep" aria-hidden="true">/</span>
      <span className="nav-lang-other">{target.toUpperCase()}</span>
    </Link>
  );
}
