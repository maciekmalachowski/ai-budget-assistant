import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Budget Assistant",
  description: "Personal spending tracker with AI categorization, Q&A, and insights.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
