import { Go } from "./Go";
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
      <Go href={`/${lang}/`} className="nav-home">
        <span className="nav-drop" aria-hidden="true" />
        <span className="nav-name">bruine</span>
      </Go>
      <nav aria-label="bruine">
        <ul className="nav-links">
          <li>
            <Go href={`/${lang}/docs/`}>{t.guide}</Go>
          </li>
          <li>
            <Go href={`/${lang}/compare/`}>{t.compare}</Go>
          </li>
          <li>
            <Go href={`/${lang}/changelog/`}>{t.changelog}</Go>
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
