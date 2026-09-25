import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canSignIn, getCurrentUser } from "./auth";
import { makeToken, verifyToken } from "./session";
import { GET } from "../app/api/auth/google/callback/route";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  countActiveAdmins: vi.fn(),
  cookies: { get: vi.fn(), set: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/lib/users", () => ({ getUser: mocks.getUser, countActiveAdmins: mocks.countActiveAdmins }));
vi.mock("next/headers", () => ({ cookies: async () => mocks.cookies }));

const email = "admin@example.com";
const secret = "test-session-secret";
const request = () => new Request("https://dashboard.example.com/api/auth/google/callback?code=test-code&state=test-state", {
  headers: { host: "dashboard.example.com" },
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ADMIN_EMAILS", email);
  vi.stubEnv("SESSION_SECRET", secret);
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-secret");
  mocks.getUser.mockResolvedValue({ email, name: "Admin", role: "admin", active: true });
  mocks.countActiveAdmins.mockResolvedValue(1);
  mocks.cookies.get.mockImplementation((name: string) => name === "bp_oauth_state" ? { value: "test-state" } : undefined);
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: "test-google-token" }))
    .mockResolvedValueOnce(Response.json({ email, email_verified: true })));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("access lookup failures", () => {
  it("does not treat a failed lookup as a missing account or use bootstrap access", async () => {
    const failure = new Error("self-signed certificate in certificate chain");
    mocks.getUser.mockRejectedValue(failure);
    await expect(canSignIn(email)).rejects.toBe(failure);
    expect(mocks.countActiveAdmins).not.toHaveBeenCalled();
  });

  it("keeps an existing session denied during a database outage", async () => {
    mocks.cookies.get.mockReturnValue({ value: makeToken(email, secret) });
    mocks.getUser.mockRejectedValue(new Error("database unavailable"));
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("reports unavailable access checks without issuing a session", async () => {
    mocks.getUser.mockRejectedValue(new Error("self-signed certificate in certificate chain"));
    const response = await GET(request());
    expect(response.headers.get("location")).toBe("https://dashboard.example.com/?error=access_unavailable");
    expect(mocks.cookies.set).not.toHaveBeenCalled();
  });

  it.each([null, { email, name: "Admin", role: "admin", active: false }])("still rejects an absent or inactive account: %j", async row => {
    mocks.getUser.mockResolvedValue(row);
    const response = await GET(request());
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("not_allowed");
    expect(mocks.cookies.set).not.toHaveBeenCalled();
  });

  it("admits an existing active admin and issues a valid session", async () => {
    const response = await GET(request());
    expect(response.headers.get("location")).toBe("https://dashboard.example.com/dashboard");
    expect(mocks.cookies.set).toHaveBeenCalledOnce();
    const [name, token] = mocks.cookies.set.mock.calls[0];
    expect(name).toBe("bp_session");
    expect(verifyToken(token, secret)).toBe(email);
  });
});
