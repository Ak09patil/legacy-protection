import type { Metadata, Viewport } from "next";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: "Legacy Protection: a safety net for when you can’t press confirm",
  description:
    "A concept designed for PayPal. Pauses scam payments before money leaves, and carries out the wishes you set while you were well if you can no longer manage things yourself.",
};

export const viewport: Viewport = {
  themeColor: "#F1F6F2",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
