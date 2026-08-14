import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@google-cloud/firestore', 'google-auth-library', 'google-gax'],
  async headers() {
    return [
      {
        source: '/',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0, must-revalidate',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
