import type { Metadata, Viewport } from "next";
import { Archivo, Lora } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

// Display serif used for login/hero headings — matches the invoice app.
const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "MathVision Inventory",
    template: "%s · MathVision Inventory",
  },
  description:
    "MathVision Educational Enrichment Centre — procurement & inventory management",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#F15A29",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${archivo.variable} ${lora.variable}`}>
      <body className="font-sans min-h-screen">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
