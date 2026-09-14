import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LYJ Textile｜提花、朱地与运动面料制造",
  description: "LYJ Textile 专注提花、朱地与运动针织面料的开发与生产，为服装品牌提供从打样到量产的面料解决方案。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
