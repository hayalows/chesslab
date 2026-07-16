import type { Metadata, Viewport } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import "./globals.css";
import PwaRegister from "@/components/PwaRegister";

const body = DM_Sans({ variable: "--font-body", subsets: ["latin"] });
const display = Manrope({ variable: "--font-display", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RivalMind - Chess training that explains itself",
  description: "Play Stockfish, understand every turning point, and build a training path that adapts to you.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "RivalMind", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#263552" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body>{children}<PwaRegister /></body>
    </html>
  );
}
