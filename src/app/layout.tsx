import localFont from "next/font/local";
import "./theme.css";
import "./globals.css";
import "./tables.css";
import "./typography.css";
import "./workflows.css";
import "./queue.css";

const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
  fallback: ["Arial"],
});

export const metadata = {
  title: "Bolna Calls — WareOnGo",
  description: "Call data dashboard for Bolna voice-AI verification calls.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the pre-paint script below sets data-theme on <html>
    // before hydration, so this one attribute intentionally differs server vs client.
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Apply saved theme before paint to avoid a light flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
