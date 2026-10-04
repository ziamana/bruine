import Link from "next/link";
import { DICTS, REPO, type Lang } from "@/lib/i18n";
import { GitHubMark } from "./Icons";
import { LangSwitch } from "./LangSwitch";

export function Nav({ lang }: { lang: Lang }) {
  const t = DICTS[lang].nav;
  return (
    <header className="nav">
      <a className="skip" href="#main">
        {t.skip}
      </a>
      <Link href={`/${lang}/`} className="nav-home">
        <span className="nav-drop" aria-hidden="true" />
        <span className="nav-name">bruine</span>
      </Link>
      <nav aria-label="bruine">
        <ul className="nav-links">
          <li>
            <Link href={`/${lang}/docs/`}>{t.guide}</Link>
          </li>
          <li>
            <Link href={`/${lang}/compare/`}>{t.compare}</Link>
          </li>
          <li>
            <Link href={`/${lang}/changelog/`}>{t.changelog}</Link>
          </li>
          <li>
            <a href={REPO} className="nav-gh">
              <GitHubMark />
              <span className="nav-gh-label">{t.github}</span>
            </a>
          </li>
          <li>
            <LangSwitch lang={lang} label={t.language} other={t.other} />
          </li>
        </ul>
      </nav>
    </header>
  );
}
