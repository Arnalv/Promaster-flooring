import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import twilio from "twilio";
import nodemailer from "nodemailer";

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

app.use(express.json({ limit: "1mb" }));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

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
  res.render("index", {
    title: "Promaster Floors",
    description: "Flooring contractor serving Dallas / Fort Worth, Texas.",
    contentByLang,
    content,
    lang,
    photos,
  });
});

app.get("/edit", (req, res) => {
  res.render("edit", {
    title: "Promaster Floors",
    description: "Flooring contractor serving Dallas / Fort Worth, Texas.",
    contentByLang,
    content,
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

app.post("/api/contact", async (req, res) => {
  const { message, email, phone } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Message is required" });
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

app.listen(port, console.log(`listening on port ${port}`));
