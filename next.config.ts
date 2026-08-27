import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Upstream feeds are plain JSON/text over https; nothing else is fetched.
  poweredByHeader: false,
};

export default nextConfig;
