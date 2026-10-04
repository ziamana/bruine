/**
 * Static export: the site is plain files, hostable anywhere. BASE_PATH serves it under a sub-path
 * (GitHub Pages). PREVIEW=1 builds the preview: every URL relative, finished by scripts/preview.mjs.
 */
const basePath = process.env.BASE_PATH ?? "";
const preview = process.env.PREVIEW === "1";

/** @type {import('next').NextConfig} */
export default {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: preview ? "." : undefined,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_PREVIEW: preview ? "1" : "0" },
  poweredByHeader: false,
};
