import type { Metadata } from "next";
import { Atkinson_Hyperlegible } from "next/font/google";
import "./globals.css";

// Atkinson Hyperlegible keeps letters apart that Arial makes the same, such as a capital I and a small l, which the
// first-letter hints depend on (Tim, 9 November).
const legible = Atkinson_Hyperlegible({ subsets: ["latin"], weight: ["400", "700"], display: "swap" });

export const metadata: Metadata = {
  title: "Talk Trainer",
  description: "Learn a talk word for word.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className={legible.className}>{children}</body>
    </html>
  );
}
