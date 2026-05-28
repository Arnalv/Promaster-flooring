import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";

let app;

beforeAll(async () => {
  app = (await import("../index.js")).default;
});

describe("GET /login", () => {
  it("renders the login page", async () => {
    const res = await request(app).get("/login");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Login");
  });
});

describe("POST /login", () => {
  it("rejects invalid credentials", async () => {
    const res = await request(app)
      .post("/login")
      .type("form")
      .send({ username: "wrong", password: "wrong" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("Invalid credentials");
  });
});

describe("Protected routes", () => {
  it("redirects /edit to /login when not authenticated", async () => {
    const res = await request(app).get("/edit");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  it("redirects /api/save to /login when not authenticated", async () => {
    const res = await request(app).post("/api/save");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  it("redirects /api/upload-gallery to /login when not authenticated", async () => {
    const res = await request(app).post("/api/upload-gallery");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });

  it("redirects DELETE /api/gallery to /login when not authenticated", async () => {
    const res = await request(app).delete("/api/gallery");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });
});

describe("GET /logout", () => {
  it("redirects to /login", async () => {
    const res = await request(app).get("/logout");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/login");
  });
});
