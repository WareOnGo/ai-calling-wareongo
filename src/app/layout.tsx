import "./globals.css";

export const metadata = {
  title: "Bolna Calls — WareOnGo",
  description: "Call data dashboard for Bolna voice-AI verification calls.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the pre-paint script below sets data-theme on <html>
    // before hydration, so this one attribute intentionally differs server vs client.
    <html lang="en" suppressHydrationWarning>
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
