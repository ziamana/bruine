import type { Metadata } from "next";
import { asset } from "@/lib/i18n";

export const metadata: Metadata = { title: "bruine", robots: { index: false } };

/** The bare address picks a language: French for a French browser, English otherwise. */
export default function Pick() {
  const en = asset("/en/");
  const fr = asset("/fr/");
  const pick = `location.replace((navigator.languages||[navigator.language]).some(function(l){return /^fr/i.test(l)})?${JSON.stringify(fr)}:${JSON.stringify(en)})`;
  return (
    <>
      <meta httpEquiv="refresh" content={`2;url=${en}`} />
      <script dangerouslySetInnerHTML={{ __html: pick }} />
      <main className="pick">
        <a href={en} hrefLang="en">bruine in English</a>
        <a href={fr} hrefLang="fr" lang="fr">bruine en français</a>
      </main>
    </>
  );
}
