import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { describe, expect, it } from "vitest";
import { databaseTls } from "./database-tls";

describe("database certificate verification", () => {
  it.each(["aws-1-ap-south-1.pooler.supabase.com", "db.example.supabase.co"])("trusts the official Supabase root for %s without extra deployment variables", hostname => {
    const ssl = databaseTls(hostname, {});
    expect(ssl).toMatchObject({ rejectUnauthorized: true });
    if (!ssl || !Array.isArray(ssl.ca)) throw new Error("Expected Supabase trust roots");
    expect(ssl.ca).toEqual(expect.arrayContaining([...rootCertificates]));
    const root = new X509Certificate(ssl.ca[ssl.ca.length - 1]);
    expect(root.fingerprint256).toBe("80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA");
    expect(root.ca).toBe(true);
  });

  it.each(["database.example.com", "supabase.com.evil.test", "aws-1.pooler.supabase.com.evil.test", "notsupabase.co", "pooler.supabase.com"])("uses normal verified TLS for %s", hostname => {
    expect(databaseTls(hostname, {})).toEqual({ rejectUnauthorized: true });
  });

  it("honours a custom trust anchor and accepts literal newlines", () => {
    expect(databaseTls("aws-1-ap-south-1.pooler.supabase.com", { DATABASE_SSL_CA: "custom\\ncertificate" }))
      .toEqual({ rejectUnauthorized: true, ca: "custom\ncertificate" });
  });

  it("preserves explicit local TLS overrides", () => {
    expect(databaseTls("localhost", { DATABASE_SSL: "disable" })).toBe(false);
    expect(databaseTls("localhost", { DATABASE_SSL: "insecure" })).toEqual({ rejectUnauthorized: false });
  });
});
