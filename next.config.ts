import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Uploads (receipts, request photos, item photos) go through Server
  // Actions, whose request body defaults to a 1MB cap — smaller than a phone
  // photo, so receipts silently failed. Lift it above the app's own 10MB
  // per-file limit (checked in the upload actions) with headroom for the
  // multipart envelope.
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
