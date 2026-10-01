import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
  },
  title: {
    default: "Aegis",
    template: "%s · Aegis",
  },
  description:
    "Institutional multi-party deal infrastructure. Negotiation, approval, and settlement on a verifiable transaction record.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0d12",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} min-h-full antialiased`}
    >
      <body className="min-h-screen bg-bg text-fg">
        {process.env.NEXT_PUBLIC_DEMO_MODE === "true" && (
          <div className="sticky top-0 z-[100] border-b border-amber/30 bg-amber-soft px-4 py-1.5 text-center text-[11px] font-medium text-amber">
            Demo mode — provider quotes, ledger confirmations and settlement results are simulated.
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
