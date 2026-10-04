"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PREVIEW, type Lang } from "@/lib/i18n";

/** The same page in the other language. */
export function LangSwitch({ lang, label, other }: { lang: Lang; label: string; other: string }) {
  const path = usePathname() ?? `/${lang}/`;
  const target: Lang = lang === "en" ? "fr" : "en";
  const href = path.replace(/^\/(en|fr)(?=\/|$)/, `/${target}`);
  // The preview build lives under an unknown address: find this page's place in it from the URL.
  const [previewHref, setPreviewHref] = useState(`${target}/index.html`);
  useEffect(() => {
    if (!PREVIEW) return;
    const rest = /\/(?:en|fr)\/(.*)$/.exec(window.location.pathname)?.[1]?.replace(/index\.html$/, "") ?? "";
    setPreviewHref(`${target}/${rest}index.html`);
  }, [target]);
  const body = (
    <>
      <span aria-hidden="true">{lang.toUpperCase()}</span>
      <span className="nav-lang-sep" aria-hidden="true">/</span>
      <span className="nav-lang-other">{target.toUpperCase()}</span>
    </>
  );
  return PREVIEW ? (
    <a className="nav-lang" href={previewHref} hrefLang={target} lang={target} aria-label={`${label}: ${other}`}>
      {body}
    </a>
  ) : (
    <Link className="nav-lang" href={href.endsWith("/") ? href : `${href}/`} hrefLang={target} lang={target} aria-label={`${label}: ${other}`}>
      {body}
    </Link>
  );
}
