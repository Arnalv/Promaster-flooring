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
