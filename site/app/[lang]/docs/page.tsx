import type { Metadata } from "next";
import { Doc } from "@/components/Doc";
import { DOCS } from "@/content/docs";
import { isLang, type Lang } from "@/lib/i18n";

const langOf = async (params: Promise<{ lang: string }>): Promise<Lang> => {
  const { lang } = await params;
  return isLang(lang) ? lang : "en";
};

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const d = DOCS[await langOf(params)];
  return { title: d.title, description: d.lead };
}

export default async function DocsPage({ params }: { params: Promise<{ lang: string }> }) {
  const d = DOCS[await langOf(params)];
  return <Doc title={d.title} lead={d.lead} sections={d.sections} tocLabel={d.toc} />;
}
