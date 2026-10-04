import Link from "next/link";
import { DICTS, REPO, VERSION, type Lang } from "@/lib/i18n";

export function Footer({ lang }: { lang: Lang }) {
  const t = DICTS[lang];
  return (
    <footer className="footer">
      <p className="footer-line">
        <span className="footer-name">bruine</span> {t.footer.line}
      </p>
      <ul className="footer-links">
        <li>
          <Link href={`/${lang}/docs/`}>{t.nav.guide}</Link>
        </li>
        <li>
          <Link href={`/${lang}/compare/`}>{t.nav.compare}</Link>
        </li>
        <li>
          <Link href={`/${lang}/changelog/`}>
            {t.nav.changelog} <span className="footer-dim">v{VERSION}</span>
          </Link>
        </li>
        <li>
          <a href={REPO}>{t.nav.github}</a>
        </li>
        <li>
          <a href={`${REPO}/blob/main/LICENSE`}>{t.footer.license}</a>
        </li>
        <li>
          <a href="https://github.com/deepseek-ai/deepseek-harness">{t.footer.built}</a>
        </li>
      </ul>
    </footer>
  );
}
