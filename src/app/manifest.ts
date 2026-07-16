import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RivalMind Chess Training",
    short_name: "RivalMind",
    description: "Play Stockfish and turn every game into a lesson.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#263552",
    orientation: "any",
    icons: [
      { src: "/rivalmind-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/rivalmind-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
