import type { Metadata } from "next";
import { Table } from "@/components/Doc";
import { InstallBand } from "@/components/InstallBand";
import { COMPARE } from "@/content/compare";
import { isLang, type Lang } from "@/lib/i18n";

const langOf = async (params: Promise<{ lang: string }>): Promise<Lang> => {
  const { lang } = await params;
  return isLang(lang) ? lang : "en";
};

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const c = COMPARE[await langOf(params)];
  return { title: c.title, description: c.lead };
}

export default async function ComparePage({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  const c = COMPARE[lang];
  return (
    <main className="prose prose-wide">
      <h1>{c.title}</h1>
      <p className="prose-lead">{c.lead}</p>
      <Table className="compare-table" head={c.head} rows={c.rows} />
      <h2 id="behind">{c.behindTitle}</h2>
      {c.behind}
      <h2 id="fit">{c.fitTitle}</h2>
      <dl className="fit">
        {c.fit.map((f) => (
          <div key={f.who}>
            <dt>{f.who}</dt>
            <dd>{f.tool}</dd>
          </div>
        ))}
      </dl>
      <div className="prose-band">
        <InstallBand lang={lang} id="install-compare" />
      </div>
    </main>
  );
}
