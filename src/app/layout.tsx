import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
});

// Sem páginas pré-renderizadas: o CDN da Hostinger honra o s-maxage do HTML
// estático e continuaria servindo, após cada deploy, páginas antigas com IDs
// de server actions que não existem mais (login quebrava com erro 500).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portal ABIEC — Área do Associado",
  description:
    "Portal da ABIEC operado pela Mais Corporativo: solicitação de aéreo, eventos institucionais com convites e credenciamento, e linha direta para solicitação de viagens.",
  icons: { icon: "/favicon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
