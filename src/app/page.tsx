export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 640 }}>
      <h1>Bolna Processing</h1>
      <p>Webhook receiver + enrichment worker. Endpoints:</p>
      <ul>
        <li>
          <code>POST /api/bolna-webhook</code> — receives Bolna execution webhooks
        </li>
        <li>
          <code>POST /api/process</code> — scheduler-triggered enrichment worker
        </li>
        <li>
          <code>GET /api/health</code> — DB check + pending count
        </li>
      </ul>
    </main>
  );
}
