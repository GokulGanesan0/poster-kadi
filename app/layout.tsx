import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Poster Kadai Print Layout Generator",
  description: "A3 poster print layout generator for A4, A5, A6, and mixed sheet packing."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
