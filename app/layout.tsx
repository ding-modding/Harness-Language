import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Harness Studio | Language Runtime & Execution VM",
  description: "Next.js based execution dashboard and IDE for Harness DSL",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-[#0B0F17] text-slate-100 antialiased selection:bg-cyan-500 selection:text-black">
        {children}
      </body>
    </html>
  );
}
