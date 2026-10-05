import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Canonical site URL for absolute Open Graph / Twitter image URLs.
 * Set NEXT_PUBLIC_SITE_URL (e.g. https://seg7lab.<subdomain>.workers.dev)
 * as a build environment variable in Cloudflare Workers Builds — without
 * it Next falls back to localhost, which social scrapers cannot reach.
 */
function resolveMetadataBase(): URL | undefined {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return undefined;
  try {
    return new URL(siteUrl);
  } catch {
    return undefined;
  }
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: "SEG7 Lab — The decoder, decoded.",
  description:
    "SEG7 Lab is the digital logic laboratory that turns one truth table into Karnaugh maps, Quine-McCluskey expressions and a live gate-level circuit. Design a BCD/hex 7-segment decoder: editable truth table, Gray-code K-maps, custom characters and Verilog/PDF/CircuitVerse export.",
  applicationName: "SEG7 Lab",
  keywords: [
    "SEG7 Lab", "7-segment display", "digital logic", "Karnaugh map",
    "Quine-McCluskey", "truth table", "Boolean algebra", "BCD decoder",
    "logic gates", "Verilog",
  ],
  icons: {
    icon: "/seg7-mark.svg",
  },
  openGraph: {
    title: "SEG7 Lab — The decoder, decoded.",
    description:
      "One truth table → Karnaugh maps → minimal Boolean expressions → a live gate-level circuit → real exports. Every step visible, consistent and explained.",
    type: "website",
    siteName: "SEG7 Lab",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "SEG7 Lab — the decoder, decoded." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SEG7 Lab — The decoder, decoded.",
    description:
      "One truth table → K-maps → minimal expressions → live gates → Verilog/PDF export.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
