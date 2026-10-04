import Link from "next/link";
import type { ComponentProps } from "react";
import { pagePath, PREVIEW } from "@/lib/i18n";

/** A link to a page of the site: Next's Link, or a plain relative link in the preview build. */
export function Go({ href, ...rest }: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  return PREVIEW ? <a href={pagePath(href)} {...rest} /> : <Link href={href} {...rest} />;
}
