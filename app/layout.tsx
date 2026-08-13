import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Life is a Gamble — Post-Federal RPG",
  description: "A playable isometric post-apocalyptic RPG vertical slice set across the Upstate New York wasteland.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Life is a Gamble",
    description: "Every choice pulls the lever in this Upstate New York post-apocalyptic RPG.",
    images: [{ url: "/og.png", width: 1792, height: 1024, alt: "Life is a Gamble — Every Choice Pulls the Lever" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Life is a Gamble",
    description: "Every choice pulls the lever.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
