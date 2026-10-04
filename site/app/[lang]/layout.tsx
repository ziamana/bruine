import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { Rain } from "@/components/Rain";
import { asset, DICTS, isLang, LANGS } from "@/lib/i18n";
import { mono, sans } from "@/lib/fonts";
import "../globals.css";

export const dynamicParams = false;
export const generateStaticParams = () => LANGS.map((lang) => ({ lang }));

export const viewport: Viewport = { themeColor: "#0b0d14", colorScheme: "dark" };

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  const t = DICTS[lang].meta;
  return {
    title: { default: t.title, template: "%s · bruine" },
    description: t.description,
    icons: { icon: asset("/icon.svg") },
    alternates: { languages: { en: asset("/en/"), fr: asset("/fr/") } },
    openGraph: { title: t.title, description: t.description, images: [asset("/media/film-poster.jpg")], type: "website" },
  };
}

export default async function LangLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return (
    <html lang={lang} className={`${mono.variable} ${sans.variable}`}>
      <body>
        <Rain />
        <Nav lang={lang} />
        <div id="main" className="page">
          {children}
        </div>
        <Footer lang={lang} />
      </body>
    </html>
  );
}
