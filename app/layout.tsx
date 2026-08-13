import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Life is a Gamble — Post-Federal RPG",
  description: "Walk and explore a post-apocalyptic downtown Syracuse in this isometric Upstate New York RPG.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Life is a Gamble",
    description: "Explore a dense modular post-apocalyptic city level in downtown Syracuse.",
    images: [{ url: "/og-v3.png", width: 1792, height: 1024, alt: "Life is a Gamble — A City Built to Be Explored" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Life is a Gamble",
    description: "A city built to be explored.",
    images: ["/og-v3.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
