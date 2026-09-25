"use client";

import { ThemeProvider as NextThemes } from "next-themes";
import { useEffect } from "react";

import { applyTheme, loadTheme } from "@/lib/theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyTheme(loadTheme());
  }, []);
  return (
    <NextThemes attribute="class" defaultTheme="dark" enableSystem={false} themes={["light", "dark"]}>
      {children}
    </NextThemes>
  );
}
