import type { Metadata } from "next";
import { CHANGELOG } from "@/content/changelog";
import { isLang, type Lang } from "@/lib/i18n";

const langOf = async (params: Promise<{ lang: string }>): Promise<Lang> => {
  const { lang } = await params;
  return isLang(lang) ? lang : "en";
};

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const c = CHANGELOG[await langOf(params)];
  return { title: c.title, description: c.lead };
}

export default async function ChangelogPage({ params }: { params: Promise<{ lang: string }> }) {
  const c = CHANGELOG[await langOf(params)];
  return (
    <main className="prose">
      <h1>{c.title}</h1>
      <p className="prose-lead">{c.lead}</p>
      {c.releases.map((release) => (
        <section key={release.version} className="release" aria-labelledby={`v-${release.version}`}>
          <h2 id={`v-${release.version}`}>
            {release.version}
            {release.latest ? <span className="release-tag">{c.latest}</span> : null}
          </h2>
          {release.groups.map((group) => (
            <div key={group.title}>
              <h3>{group.title}</h3>
              <ul>
                {group.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
