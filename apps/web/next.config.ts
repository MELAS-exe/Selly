import path from 'node:path';
import type { NextConfig } from 'next';

const core = process.env.CORE_URL ?? 'http://localhost:4000';
const agent = process.env.AGENT_URL ?? 'http://localhost:4100';

const config: NextConfig = {
  output: 'standalone',
  // Monorepo root, so the standalone build traces files from workspace packages (needed by the Docker image).
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@selly/ui'],
  // The floating dev badge covers the dashboard's bottom bar and sidebar in screenshots.
  devIndicators: false,
  // Mirrors production routing (docs/architecture.md section 11.1): chat, inbox and assistant go to the agent,
  // every other /api/v1 path goes to core. Internal endpoints are never proxied.
  async rewrites() {
    return [
      { source: '/api/v1/chat/:path*', destination: `${agent}/api/v1/chat/:path*` },
      {
        source: '/api/v1/conversations/:path*',
        destination: `${agent}/api/v1/conversations/:path*`,
      },
      { source: '/api/v1/conversations', destination: `${agent}/api/v1/conversations` },
      { source: '/api/v1/assistant/:path*', destination: `${agent}/api/v1/assistant/:path*` },
      { source: '/api/v1/:path*', destination: `${core}/api/v1/:path*` },
    ];
  },
};

export default config;
