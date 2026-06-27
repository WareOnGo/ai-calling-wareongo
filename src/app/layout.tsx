export const metadata = {
  title: "Bolna Processing",
  description: "Receives Bolna post-call webhooks, enriches with OpenAI, stores in Supabase.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
