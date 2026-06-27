import "./globals.css";

export const metadata = {
  title: "Bolna Calls — WareOnGo",
  description: "Call data dashboard for Bolna voice-AI verification calls.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
