import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { fileURLToPath } from "url";
import twilio from "twilio";
import nodemailer from "nodemailer";
import multer from "multer";
import bcrypt from "bcryptjs";
import session from "express-session";
import FileStore from "session-file-store";
import helmet from "helmet";
import sanitizeHtml from "sanitize-html";

const sanitize = (s) => sanitizeHtml(typeof s === "string" ? s : "", {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img", "h1", "h2", "span", "div"]),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    "*": ["class", "id", "style"],
    a: ["href", "target", "class", "id", "style"],
    img: ["src", "alt", "class", "id", "style"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  disallowedTagsMode: "discard",
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 4001;

const contentPath = path.join(__dirname, "content.json");
let content = {};
let contentByLang = { en: {}, es: {} };

function rebuildContentByLang() {
  contentByLang = { en: {}, es: {} };
  for (const [eid, langs] of Object.entries(content)) {
    for (const [lang, text] of Object.entries(langs)) {
      if (!contentByLang[lang]) contentByLang[lang] = {};
      contentByLang[lang][eid] = text;
    }
  }
}

async function loadContent() {
  try {
    const raw = await fs.readFile(contentPath, "utf-8");
    content = JSON.parse(raw);
    rebuildContentByLang();
  } catch {
    content = {};
    contentByLang = { en: {}, es: {} };
  }
}
await loadContent();

let googleTranslate;
async function getTranslator() {
  if (!googleTranslate) {
    googleTranslate = (await import("@iamtraction/google-translate")).default;
  }
  return googleTranslate;
}

async function translateText(text, to) {
  const t = await getTranslator();
  const result = await t(text, { to });
  return result.text;
}

async function validateImageFile(filePath) {
  const fd = await fs.open(filePath, "r");
  const buf = Buffer.alloc(8);
  await fd.read(buf, 0, 8, 0);
  await fd.close();
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E) return true;
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46) return true;
  return false;
}

function sameOrigin(req, res, next) {
  const host = req.headers.host;
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (origin && !origin.includes(host)) {
    return res.status(403).json({ error: "Cross-origin request rejected" });
  }
  if (!origin && referer) {
    try {
      if (new URL(referer).host !== host) {
        return res.status(403).json({ error: "Cross-origin request rejected" });
      }
    } catch {
      return res.status(403).json({ error: "Invalid request" });
    }
  }
  next();
}

const loginAttempts = new Map();
const LOGIN_MAX = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function loginRateLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const data = loginAttempts.get(ip);
  if (!data || now - data.start > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, start: now });
    return next();
  }
  if (data.count >= LOGIN_MAX) {
    return res.status(429).render("login", { error: "Too many attempts. Try again later." });
  }
  data.count++;
  next();
}

const contactAttempts = new Map();
const CONTACT_MAX = 5;
const CONTACT_WINDOW_MS = 60 * 1000;

function contactRateLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const data = contactAttempts.get(ip);
  if (!data || now - data.start > CONTACT_WINDOW_MS) {
    contactAttempts.set(ip, { count: 1, start: now });
    return next();
  }
  if (data.count >= CONTACT_MAX) {
    return res.status(429).json({ error: "Too many requests. Try again later." });
  }
  data.count++;
  next();
}

app.use(express.json({ limit: "1mb" }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1);
app.use(express.static(path.join(__dirname, "public")));

app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString("hex");
  next();
});

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.warn("WARNING: SESSION_SECRET not set in .env — using insecure default. Set a random value.");
}
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "https://images.unsplash.com"],
      frameSrc: ["'self'", "https://sites-api.arnalv.net"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
    },
  },
}));

function cleanupRateLimits() {
  const now = Date.now();
  for (const [ip, data] of loginAttempts) {
    if (now - data.start > LOGIN_WINDOW_MS) loginAttempts.delete(ip);
  }
  for (const [ip, data] of contactAttempts) {
    if (now - data.start > CONTACT_WINDOW_MS) contactAttempts.delete(ip);
  }
}
setInterval(cleanupRateLimits, 60_000);

const SessionFileStore = FileStore(session);

app.use(session({
  secret: sessionSecret || "edit-server-secret",
  resave: false,
  saveUninitialized: false,
  store: new SessionFileStore({ path: path.join(__dirname, "sessions") }),
  cookie: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    httpOnly: true,
  },
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect("/login");
}

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", express.urlencoded({ extended: false }), loginRateLimiter, async (req, res) => {
  const { username, password } = req.body;
  const expectedUser = process.env.EDIT_USERNAME;
  const expectedHash = process.env.EDIT_PASSWORD_HASH;
  if (!expectedUser || !expectedHash) {
    return res.render("login", { error: "Server not configured" });
  }
  if (username !== expectedUser) {
    return res.render("login", { error: "Invalid credentials" });
  }
  try {
    const match = await bcrypt.compare(password, expectedHash);
    if (!match) {
      return res.render("login", { error: "Invalid credentials" });
    }
    req.session.authenticated = true;
    res.redirect("/edit");
  } catch {
    res.render("login", { error: "Server error" });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

app.get("/", async (req, res) => {
  const lang = req.query.lang === "es" ? "es" : "en";
  let photos = [];
  try {
    const files = await fs.readdir(path.join(__dirname, "public", "projects"));
    photos = files.filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort();
  } catch {}

  const categories = {
    flooring: { label: "Floor and Tile Remodeling", files: [] },
    outdoor: { label: "Outdoor Remodeling", files: [] },
    bathroom: { label: "Bathroom Remodeling", files: [] },
    staircase: { label: "Staircase Remodeling", files: [] },
  };

  photos.forEach((f) => {
    const lower = f.toLowerCase();
    if (lower.includes("flooring") || lower.includes("kitchen") || lower.includes("fireplace")) {
      categories.flooring.files.push(f);
    } else if (lower.includes("bathroom") || lower.includes("bathroon")) {
      categories.bathroom.files.push(f);
    } else if (lower.includes("outdoor")) {
      categories.outdoor.files.push(f);
    } else if (lower.includes("staircase")) {
      categories.staircase.files.push(f);
    } else {
      categories.outdoor.files.push(f);
    }
  });

  Object.keys(categories).forEach((key) => {
    categories[key].files.sort((a, b) => {
      const aFire = a.toLowerCase().includes("fireplace");
      const bFire = b.toLowerCase().includes("fireplace");
      if (aFire && !bFire) return 1;
      if (!aFire && bFire) return -1;
      return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
  });

  const galleryCategories = Object.keys(categories).map((key) => ({
    key,
    label: categories[key].label,
    files: categories[key].files,
  }));

  res.render("index", {
    title: "Promaster Floors",
    description: "Flooring contractor serving Dallas / Fort Worth, Texas.",
    contentByLang,
    content,
    lang,
    photos,
    galleryCategories,
  });
});

app.get("/terms", async (req, res) => {
  try {
    const termsText = await fs.readFile(path.join(__dirname, "public", "terms-of-service.txt"), "utf-8");
    res.render("terms", {
      title: "Terms of Service — Promaster Floors",
      termsText,
    });
  } catch {
    res.status(500).send("Could not load terms of service.");
  }
});

app.get("/privacy", async (req, res) => {
  try {
    const policyText = await fs.readFile(path.join(__dirname, "public", "privacy-policy.txt"), "utf-8");
    res.render("privacy", {
      title: "Privacy Policy — Promaster Floors",
      policyText,
    });
  } catch {
    res.status(500).send("Could not load privacy policy.");
  }
});

app.post("/api/contact", sameOrigin, contactRateLimiter, async (req, res) => {
  const { message, email, phone } = req.body;
  if (!message || typeof message !== "string" || message.length > 5000) {
    return res.status(400).json({ error: "Message is required (max 5000 chars)" });
  }
  if (email && (typeof email !== "string" || email.length > 320)) {
    return res.status(400).json({ error: "Invalid email" });
  }
  if (phone && (typeof phone !== "string" || phone.length > 30)) {
    return res.status(400).json({ error: "Invalid phone" });
  }

  const text = `New inquiry from promasterfloors.com\n\nMessage: ${message}\nEmail: ${email || "N/A"}\nPhone: ${phone || "N/A"}`;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.TO_EMAIL,
      subject: "New inquiry from promasterfloors.com",
      text,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Email error:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// ─── Edit / Admin Routes ────────────────────────────────────────────

const uploadsDir = path.join(__dirname, "public", "uploads");
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "image/svg+xml" || path.extname(file.originalname).toLowerCase() === ".svg") {
      return cb(new Error("SVG files are not allowed"));
    }
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

const projectsDir = path.join(__dirname, "public", "projects");
const pendingDir = path.join(projectsDir, "pending");
const projectStorage = multer.diskStorage({
  destination: pendingDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  },
});
const projectUpload = multer({
  storage: projectStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "image/svg+xml" || path.extname(file.originalname).toLowerCase() === ".svg") {
      return cb(new Error("SVG files are not allowed"));
    }
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

app.get("/edit", requireAuth, async (req, res) => {
  let galleryCategories = [];
  try {
    let approvedFiles = [], pendingFiles = [];
    try {
      approvedFiles = await fs.readdir(projectsDir);
    } catch {}
    try {
      pendingFiles = await fs.readdir(pendingDir);
    } catch {}
    approvedFiles = approvedFiles.filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort();
    pendingFiles = pendingFiles.filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort();
    const photos = [...pendingFiles.map((f) => ({ name: f, pending: true })), ...approvedFiles.map((f) => ({ name: f, pending: false }))];
    const categories = {
      flooring: { label: "Floor and Tile Remodeling", files: [] },
      outdoor: { label: "Outdoor Remodeling", files: [] },
      bathroom: { label: "Bathroom Remodeling", files: [] },
      staircase: { label: "Staircase Remodeling", files: [] },
    };
    photos.forEach((f) => {
      const name = typeof f === "string" ? f : f.name;
      const lower = name.toLowerCase();
      const entry = typeof f === "string" ? f : f;
      if (lower.includes("flooring") || lower.includes("kitchen") || lower.includes("fireplace")) {
        categories.flooring.files.push(entry);
      } else if (lower.includes("bathroom") || lower.includes("bathroon")) {
        categories.bathroom.files.push(entry);
      } else if (lower.includes("outdoor")) {
        categories.outdoor.files.push(entry);
      } else if (lower.includes("staircase")) {
        categories.staircase.files.push(entry);
      } else {
        categories.outdoor.files.push(entry);
      }
    });
    Object.keys(categories).forEach((key) => {
      categories[key].files.sort((a, b) => {
        const aName = typeof a === "string" ? a : a.name;
        const bName = typeof b === "string" ? b : b.name;
        const aFire = aName.toLowerCase().includes("fireplace");
        const bFire = bName.toLowerCase().includes("fireplace");
        if (aFire && !bFire) return 1;
        if (!aFire && bFire) return -1;
        return aName.localeCompare(bName, undefined, { sensitivity: "base" });
      });
    });
    galleryCategories = Object.keys(categories).map((key) => ({
      key,
      label: categories[key].label,
      files: categories[key].files,
    }));
  } catch {}

  res.render("edit", {
    title: "Promaster Floors",
    description: "Flooring contractor serving Dallas / Fort Worth, Texas.",
    contentByLang,
    content,
    galleryCategories,
  });
});

app.post("/api/save", requireAuth, sameOrigin, async (req, res) => {
  const { en, es, dirtyEn, dirtyEs } = req.body;
  if (!en || typeof en !== "object") {
    return res.status(400).json({ error: "Invalid data" });
  }
  for (const text of Object.values(en)) {
    if (typeof text !== "string" || text.length > 50000) {
      return res.status(400).json({ error: "Text too long (max 50000 chars)" });
    }
  }
  if (es && typeof es === "object") {
    for (const text of Object.values(es)) {
      if (typeof text !== "string" || text.length > 50000) {
        return res.status(400).json({ error: "Text too long (max 50000 chars)" });
      }
    }
  }

  let pendingMoved = false;

  try {
    let pendingFiles = [];
    try {
      pendingFiles = await fs.readdir(pendingDir);
    } catch {}
    if (pendingFiles.length > 0) {
      for (const f of pendingFiles) {
        const src = path.join(pendingDir, f);
        const dest = path.join(projectsDir, f);
        try {
          await fs.rename(src, dest);
          pendingMoved = true;
        } catch {}
      }
    }

    for (const [eid, text] of Object.entries(en)) {
      const clean = sanitize(text);
      if (content[eid]) {
        content[eid].en = clean;
      } else {
        content[eid] = { en: clean, es: "" };
      }
    }

    const finalEs = es && typeof es === "object" ? { ...es } : {};
    for (const [eid, text] of Object.entries(finalEs)) {
      const clean = sanitize(text);
      if (content[eid]) {
        content[eid].es = clean;
      } else {
        content[eid] = { en: "", es: clean };
      }
    }

    const translations = {};

    if (dirtyEn && typeof dirtyEn === "object") {
      for (const eid in dirtyEn) {
        if (!dirtyEs || !dirtyEs[eid]) {
          const text = content[eid]?.en;
          if (text && text.trim()) {
            try {
              const result = await translateText(text, "es");
              content[eid].es = result;
              translations[eid] = { es: result };
            } catch {}
          }
        }
      }
    }

    if (dirtyEs && typeof dirtyEs === "object") {
      for (const eid in dirtyEs) {
        if (!dirtyEn || !dirtyEn[eid]) {
          const text = content[eid]?.es;
          if (text && text.trim()) {
            try {
              const result = await translateText(text, "en");
              content[eid].en = result;
              if (!translations[eid]) translations[eid] = {};
              translations[eid].en = result;
            } catch {}
          }
        }
      }
    }

    await fs.writeFile(contentPath, JSON.stringify(content, null, 2), "utf-8");
    rebuildContentByLang();
    res.json({ success: true, translations, pendingMoved });
  } catch (err) {
    console.error("Save error:", err);
    res.status(500).json({ error: "Failed to save" });
  }
});

app.post("/api/upload-image", requireAuth, sameOrigin, (req, res) => {
  upload.single("image")(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    try {
      const valid = await validateImageFile(req.file.path);
      if (!valid) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: "Invalid image file" });
      }
    } catch {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(500).json({ error: "File validation failed" });
    }
    res.json({ url: "/uploads/" + req.file.filename });
  });
});

app.post("/api/upload-gallery", requireAuth, sameOrigin, (req, res) => {
  projectUpload.single("image")(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    try {
      const valid = await validateImageFile(req.file.path);
      if (!valid) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({ error: "Invalid image file" });
      }
    } catch {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(500).json({ error: "File validation failed" });
    }
    res.json({ url: "/projects/pending/" + req.file.filename, pending: true });
  });
});

app.delete("/api/gallery", requireAuth, sameOrigin, async (req, res) => {
  const filename = req.query.filename;
  if (!filename || typeof filename !== "string") {
    return res.status(400).json({ error: "Invalid filename" });
  }
  const safe = path.basename(filename);
  const approvedPath = path.join(projectsDir, safe);
  const pendingPath = path.join(pendingDir, safe);
  try {
    await fs.unlink(approvedPath);
    return res.json({ success: true });
  } catch {}
  try {
    await fs.unlink(pendingPath);
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to delete file" });
  }
});

app.post("/api/translate", requireAuth, sameOrigin, async (req, res) => {
  const { text, to } = req.body;
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Invalid text" });
  }

  try {
    const result = await translateText(text, to || "es");
    res.json({ translation: result });
  } catch (err) {
    console.error("Translate error:", err);
    res.status(500).json({ error: "Translation failed" });
  }
});

app.post("/api/translate-all", requireAuth, sameOrigin, async (req, res) => {
  const { texts, to } = req.body;
  if (!texts || typeof texts !== "object") {
    return res.status(400).json({ error: "Invalid data" });
  }

  try {
    const translations = {};
    for (const [key, text] of Object.entries(texts)) {
      if (text && typeof text === "string" && text.trim()) {
        try {
          const result = await translateText(text, to || "es");
          translations[key] = result;
        } catch {
          translations[key] = "";
        }
      } else {
        translations[key] = "";
      }
    }
    res.json({ translations });
  } catch (err) {
    console.error("Translate all error:", err);
    res.status(500).json({ error: "Translation failed" });
  }
});

// Twilio SMS route — kept for future use
// app.post("/api/contact", async (req, res) => {
//   const { message, email, phone } = req.body;
//   if (!message || typeof message !== "string") {
//     return res.status(400).json({ error: "Message is required" });
//   }
//   const body = `New inquiry from promasterfloors.com\n\nMessage: ${message}\nEmail: ${email || "N/A"}\nPhone: ${phone || "N/A"}`;
//   try {
//     await twilioClient.messages.create({
//       body,
//       from: process.env.TWILIO_PHONE_NUMBER,
//       to: process.env.TO_PHONE,
//     });
//     res.json({ success: true });
//   } catch (err) {
//     console.error("SMS error:", err);
//     res.status(500).json({ error: "Failed to send message" });
//   }
// });

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  app.listen(port, console.log(`listening on port ${port}`));
}

export default app;
