import type { Metadata, Viewport } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/karla/400.css";
import "@fontsource/karla/700.css";
import "@fontsource/playfair-display/400.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/700.css";
import "@/styles/globals.css";
import "@/styles/dashboard.css";
import "@/styles/builder.css";
import "@/styles/results.css";
import "@/styles/runtime.css";
import "@/styles/auth.css";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ToastHost } from "@/components/ui";
import { COLOR_MODE_BOOT_SCRIPT } from "@/lib/colorMode";

export const metadata: Metadata = {
  title: "Typeform Clone",
  description: "Build beautiful, conversational forms.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: COLOR_MODE_BOOT_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
        <ToastHost />
      </body>
    </html>
  );
}
