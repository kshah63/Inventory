import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MathVision Stock",
    template: "%s · MathVision Stock",
  },
  description:
    "MathVision Educational Enrichment Centre — procurement & inventory management",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={archivo.variable}>
      <body className="font-sans min-h-screen">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
