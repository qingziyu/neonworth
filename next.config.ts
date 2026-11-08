import type { NextConfig } from "next";
import { SITES_ASSET_PREFIX } from './profiles/sites/asset-paths.mjs';

const nextConfig: NextConfig = {
  ...(process.env.NEONWORTH_HOSTING_PROFILE === 'sites' ? { assetPrefix: SITES_ASSET_PREFIX } : {}),
};

export default nextConfig;
