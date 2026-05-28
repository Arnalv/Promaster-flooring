import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

let app;

beforeAll(async () => {
  app = (await import("../index.js")).default;
});

describe("GET /", () => {
  it("renders the homepage with status 200", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Promaster Floors");
  });

  it("renders Spanish version when ?lang=es", async () => {
    const res = await request(app).get("/?lang=es");
    expect(res.status).toBe(200);
  });
});

describe("GET /terms", () => {
  it("renders terms of service", async () => {
    const res = await request(app).get("/terms");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Terms");
  });
});

describe("GET /privacy", () => {
  it("renders privacy policy", async () => {
    const res = await request(app).get("/privacy");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Privacy");
  });
});

describe("POST /api/contact", () => {
  it("returns 400 when message is missing", async () => {
    const res = await request(app)
      .post("/api/contact")
      .send({ email: "test@example.com" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 500 when email env vars are not set (fails to send)", async () => {
    const res = await request(app)
      .post("/api/contact")
      .send({ message: "Hello", email: "test@example.com", phone: "555-0100" });
    expect(res.status).toBe(500);
  });
});
