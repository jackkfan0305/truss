import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Worktrees can sit below another checkout with its own lockfile. Keep
    // Next's module graph rooted at this application in every environment.
    root: process.cwd(),
  },
};

export default nextConfig;
