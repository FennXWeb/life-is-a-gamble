import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Life is a Gamble — Post-Federal RPG",
  description: "Walk and explore a post-apocalyptic downtown Syracuse in this isometric Upstate New York RPG.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Life is a Gamble",
    description: "Walk the ruins, pick your doors, and tempt Fate in downtown Syracuse.",
    images: [{ url: "/og-v2.png", width: 1792, height: 1024, alt: "Life is a Gamble — Walk the Ruins. Pick Your Doors." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Life is a Gamble",
    description: "Walk the ruins. Pick your doors.",
    images: ["/og-v2.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
