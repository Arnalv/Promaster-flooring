import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 4001;

app.use(express.json());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.render("index", {
    title: "Promaster Floors",
    description: "Flooring contractor serving Dallas / Fort Worth, Texas.",
  });
});

app.get("/edit", (req, res) => {
  res.render("edit", {
    title: "Promaster Floors",
    description: "Flooring contractor serving Dallas / Fort Worth, Texas.",
  });
});

app.post("/api/save", async (req, res) => {
  const { edits } = req.body;
  if (!edits || typeof edits !== "object") {
    return res.status(400).json({ error: "Invalid data" });
  }

  try {
    let content = await fs.readFile(
      path.join(__dirname, "views", "index.ejs"),
      "utf-8"
    );

    for (const [eid, newText] of Object.entries(edits)) {
      const regex = new RegExp(
        `(data-eid="${eid}"[^>]*>)[\\s\\S]*?(<\\/)`,
        "g"
      );
      content = content.replace(regex, (_, prefix, suffix) => {
        return prefix + newText + suffix;
      });
    }

    await fs.writeFile(
      path.join(__dirname, "views", "index.ejs"),
      content,
      "utf-8"
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Save error:", err);
    res.status(500).json({ error: "Failed to save" });
  }
});

app.listen(port, console.log(`listening on port ${port}`));
