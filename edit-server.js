import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = 5001;

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
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

app.use(express.json({ limit: "1mb" }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/upload-image", (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    res.json({ url: "/uploads/" + req.file.filename });
  });
});

const projectsDir = path.join(__dirname, "public", "projects");
const projectStorage = multer.diskStorage({
  destination: projectsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  },
});
const projectUpload = multer({
  storage: projectStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

app.post("/api/upload-gallery", (req, res) => {
  projectUpload.single("image")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    res.json({ url: "/projects/" + req.file.filename });
  });
});

app.delete("/api/gallery", async (req, res) => {
  const filename = req.query.filename;
  if (!filename || typeof filename !== "string") {
    return res.status(400).json({ error: "Invalid filename" });
  }
  const safe = path.basename(filename);
  const filePath = path.join(__dirname, "public", "projects", safe);
  try {
    await fs.unlink(filePath);
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete file" });
  }
});

app.get("/edit", async (req, res) => {
  let galleryCategories = [];
  try {
    const files = await fs.readdir(path.join(__dirname, "public", "projects"));
    const photos = files.filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort();
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

app.post("/api/save", async (req, res) => {
  const { en, es, dirtyEn, dirtyEs } = req.body;
  if (!en || typeof en !== "object") {
    return res.status(400).json({ error: "Invalid data" });
  }

  try {
    for (const [eid, text] of Object.entries(en)) {
      if (content[eid]) {
        content[eid].en = text;
      } else {
        content[eid] = { en: text, es: "" };
      }
    }

    const finalEs = es && typeof es === "object" ? { ...es } : {};
    for (const [eid, text] of Object.entries(finalEs)) {
      if (content[eid]) {
        content[eid].es = text;
      } else {
        content[eid] = { en: "", es: text };
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
    res.json({ success: true, translations });
  } catch (err) {
    console.error("Save error:", err);
    res.status(500).json({ error: "Failed to save" });
  }
});

app.post("/api/translate", async (req, res) => {
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

app.post("/api/translate-all", async (req, res) => {
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

app.listen(port, () => console.log(`edit-server listening on port ${port}`));
