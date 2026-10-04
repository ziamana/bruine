import { Capabilities } from "@/components/Capabilities";
import { CopyCommand } from "@/components/CopyCommand";
import { Film } from "@/components/Film";
import { Go } from "@/components/Go";
import { HeroTerminal } from "@/components/HeroTerminal";
import { Arrow, Chevron, Cross, GitHubMark } from "@/components/Icons";
import { InstallBand } from "@/components/InstallBand";
import { Session } from "@/components/Session";
import { DICTS, isLang, REPO, type Lang } from "@/lib/i18n";

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  const lang = (isLang(raw) ? raw : "en") as Lang;
  const t = DICTS[lang];
  return (
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <h1 id="hero-title">{t.hero.title}</h1>
        <p className="hero-lead">{t.hero.lead}</p>
        <a className="button button-primary" href="#install">
          {t.hero.cta}
        </a>
        <HeroTerminal />
      </section>

      <section id="install" className="install" aria-label={t.band.label}>
        <InstallBand lang={lang} id="install-band" />
        <p className="hero-facts">
          <span className="hero-said">{t.hero.said}</span>
          {t.hero.facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </p>
      </section>

      <Session lang={lang} />

      <Capabilities lang={lang} />

      <section className="film" aria-labelledby="film-title">
        <header className="section-head">
          <h2 id="film-title">{t.film.title}</h2>
          <p>{t.film.lead}</p>
        </header>
        <Film title="bruine-film.mp4" play={t.film.caption} />
      </section>

      <section className="models" aria-labelledby="models-title">
        <header className="section-head">
          <h2 id="models-title">{t.models.title}</h2>
          <p>{t.models.lead}</p>
        </header>
        <ul className="providers" translate="no">
          {t.models.providers.split(" · ").map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <dl className="promises">
          {t.models.promises.map((promise) => (
            <div key={promise.title} className="promise">
              <dt>
                <span className="promise-title">{promise.title}</span>
                <span className="reading" translate="no">
                  {promise.reading}
                </span>
              </dt>
              <dd>{promise.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="devs" aria-labelledby="devs-title">
        <h2 id="devs-title">{t.devs.title}</h2>
        <div className="dev-grid">
          {t.devs.cards.map((card) => (
            <article key={card.title} className="dev-card">
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              <CopyCommand command={card.command} copy={t.devs.copy} copied={t.devs.copied} />
            </article>
          ))}
        </div>
      </section>

      <section className="behind" aria-labelledby="behind-title">
        <header className="section-head">
          <h2 id="behind-title">{t.behind.title}</h2>
          <p>{t.behind.lead}</p>
        </header>
        <ul className="behind-list">
          {t.behind.items.map((item) => (
            <li key={item}>
              <Cross />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="behind-fit">{t.behind.fit}</p>
        <Go className="more" href={`/${lang}/compare/`}>
          {t.behind.compare} <Arrow />
        </Go>
      </section>

      <section className="faq" aria-labelledby="faq-title">
        <h2 id="faq-title">{t.faq.title}</h2>
        <div className="faq-list">
          {t.faq.items.map((item) => (
            <details key={item.q}>
              <summary>
                {item.q}
                <Chevron />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="join" aria-labelledby="join-title">
        <h2 id="join-title">{t.join.title}</h2>
        <p>{t.join.lead}</p>
        <div className="join-links">
          <a className="button button-primary" href={REPO}>
            <GitHubMark size={16} /> {t.join.github}
          </a>
          <Go className="button" href={`/${lang}/docs/`}>
            {t.join.guide}
          </Go>
          <Go className="button" href={`/${lang}/docs/#mcp`}>
            {t.join.mcp}
          </Go>
          <Go className="button" href={`/${lang}/compare/`}>
            {t.join.compare}
          </Go>
        </div>
      </section>
    </main>
  );
}
