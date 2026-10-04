import { Go } from "@/components/Go";
import { InstallBand } from "@/components/InstallBand";
import { Film } from "@/components/Film";
import { Arrow } from "@/components/Icons";
import { Session } from "@/components/Session";
import { asset, DICTS, isLang, type Lang } from "@/lib/i18n";

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: raw } = await params;
  const lang = (isLang(raw) ? raw : "en") as Lang;
  const t = DICTS[lang];
  return (
    <main>
      <section className="hero" aria-labelledby="hero-title">
        <img className="hero-mark" src={asset("/media/wordmark-dark.svg")} alt="bruine" width="528" height="232" />
        <h1 id="hero-title">{t.hero.title}</h1>
        <p className="hero-lead">{t.hero.lead}</p>
        <InstallBand lang={lang} id="install" />
        <p className="hero-facts">
          <span className="hero-said">{t.hero.said}</span>
          {t.hero.facts.map((fact) => (
            <span key={fact}>{fact}</span>
          ))}
        </p>
      </section>

      <Session lang={lang} />

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

      <section className="behind" aria-labelledby="behind-title">
        <header className="section-head">
          <h2 id="behind-title">{t.behind.title}</h2>
          <p>{t.behind.lead}</p>
        </header>
        <ul className="behind-list">
          {t.behind.items.map((item) => (
            <li key={item}>{item}</li>
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
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="close" aria-labelledby="close-title">
        <h2 id="close-title">{t.close.title}</h2>
        <p>{t.close.lead}</p>
        <InstallBand lang={lang} id="install-again" />
      </section>
    </main>
  );
}
