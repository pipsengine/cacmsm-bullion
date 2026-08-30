import "./globals.css";
import React from "react";

export const metadata = {
  title: "Cacsms-Bullion",
  description: "Gold Trading OS — self-driving MT5-first platform"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

