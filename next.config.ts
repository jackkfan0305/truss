import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      /*
       * Clerk avatars (`user.imageUrl`), which reach presence through the
       * Liveblocks auth handler. Clerk proxies OAuth provider images through
       * this host, so a Google or GitHub photo is still served from
       * `img.clerk.com` and one pattern covers every provider.
       *
       * A host missing from this list is a runtime 400 from the image
       * optimizer, not a build error — check here first if an avatar renders
       * broken after touching how presence gets its photo.
       */
      {
        protocol: "https",
        hostname: "img.clerk.com",
        // Clerk encodes the whole source into one base64 path segment.
        pathname: "/**",
        /*
         * `search` is deliberately left open rather than pinned to `""`. The
         * stored URL carries no query string today, but Clerk's own helpers
         * append `?width=`, and a pinned `search` turns that into a silent 400
         * from the optimizer. The host is already narrow enough that the extra
         * lock buys little.
         */
      },
    ],
  },
};

export default nextConfig;
