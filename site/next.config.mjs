/** Static export: the site is plain files, hostable anywhere. BASE_PATH serves it under a sub-path (GitHub Pages). */
const basePath = process.env.BASE_PATH ?? "";

/** @type {import('next').NextConfig} */
export default {
  output: "export",
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  poweredByHeader: false,
};
