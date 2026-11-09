import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talk Trainer",
  description: "Learn a talk word for word.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
