import type { Metadata } from "next";

import { ThemeProvider } from "@/components/theme-provider";
import { APP_TITLE } from "@/lib/brand";

import "./globals.css";

export const metadata: Metadata = {
  title: APP_TITLE,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
