import type { MetadataRoute } from "next";

/** For "Add to home screen". The icons are drawn from components/brand.ts. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Driftwatch",
    short_name: "Driftwatch",
    description: "Breaking-change alerts for the third-party APIs your code depends on.",
    start_url: "/",
    display: "browser",
    background_color: "#fbfbfc",
    theme_color: "#fbfbfc",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
