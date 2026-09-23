import type { NextConfig } from 'next';

const config: NextConfig = {
  // Stub: no images yet, and sharp (LGPL libvips binaries) is not installed (see ADR-001).
  images: { unoptimized: true },
  transpilePackages: ['@fitadapt/i18n'],
  poweredByHeader: false,
};

export default config;
