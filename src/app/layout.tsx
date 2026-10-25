import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import "./dashboard.css";
import { AuthProvider } from "@/components/AuthProvider";
import { I18nProvider } from "@/components/I18nProvider";
import { getSessionUser } from "@/lib/auth/server";
import { LANG_COOKIE, detectLang } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Fieldnotes — Customer discovery, made clear",
  description: "A calm workspace for understanding customer interviews and product feedback.",
  icons: { icon: "/favicon.svg" },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const lang = detectLang((await cookies()).get(LANG_COOKIE)?.value, (await headers()).get("accept-language"));
  const user = await getSessionUser();
  return (
    <html lang={lang}>
      <head>
        {/* DM Sans and Manrope for Latin text, Noto Sans Devanagari so Hindi looks the same on every device. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@600;700;800&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap" />
      </head>
      <body>
        <I18nProvider initialLang={lang}>
          <AuthProvider user={user}>{children}</AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
