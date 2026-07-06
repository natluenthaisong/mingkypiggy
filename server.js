// MingkyPiggy server — Express + node:sqlite (built-in, no native compile)
// Serves the static app from /public and a small REST API guarded by a shared PIN.
const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 4178;
const PIN = process.env.APP_PIN || "1234"; // set APP_PIN on Railway!
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, "minky.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    id        TEXT PRIMARY KEY,
    detail    TEXT    DEFAULT '',
    income    REAL    DEFAULT 0,
    expense   REAL    DEFAULT 0,
    poDate    TEXT    DEFAULT '',
    billDate  TEXT    DEFAULT '',
    payDate   TEXT    DEFAULT '',
    updatedAt INTEGER DEFAULT 0
  )
`);

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  },
}));

// ── shared-PIN auth ────────────────────────────────────────────────
function auth(req, res, next) {
  if (req.get("x-app-pin") === PIN) return next();
  res.status(401).json({ error: "unauthorized" });
}

app.post("/api/login", (req, res) => {
  const pin = (req.body && req.body.pin) || req.get("x-app-pin");
  if (pin === PIN) return res.json({ ok: true });
  res.status(401).json({ ok: false });
});

// ── records CRUD ───────────────────────────────────────────────────
const upsertStmt = db.prepare(`
  INSERT INTO records (id, detail, income, expense, poDate, billDate, payDate, updatedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    detail=excluded.detail, income=excluded.income, expense=excluded.expense,
    poDate=excluded.poDate, billDate=excluded.billDate, payDate=excluded.payDate,
    updatedAt=excluded.updatedAt
`);
function upsert(r) {
  upsertStmt.run(
    String(r.id),
    r.detail || "",
    Number(r.income) || 0,
    Number(r.expense) || 0,
    r.poDate || "",
    r.billDate || "",
    r.payDate || "",
    Date.now()
  );
}
const getStmt = db.prepare("SELECT * FROM records WHERE id = ?");

app.get("/api/records", auth, (req, res) => {
  res.json(db.prepare("SELECT * FROM records ORDER BY updatedAt DESC").all());
});

app.post("/api/records", auth, (req, res) => {
  const r = req.body || {};
  if (!r.id) return res.status(400).json({ error: "id required" });
  upsert(r);
  res.json(getStmt.get(String(r.id)));
});

app.put("/api/records/:id", auth, (req, res) => {
  upsert({ ...req.body, id: req.params.id });
  res.json(getStmt.get(req.params.id));
});

app.delete("/api/records/:id", auth, (req, res) => {
  db.prepare("DELETE FROM records WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// bulk replace — used by restore/import
app.put("/api/records", auth, (req, res) => {
  const arr = Array.isArray(req.body) ? req.body : [];
  db.prepare("DELETE FROM records").run();
  for (const r of arr) if (r && r.id) upsert(r);
  res.json({ ok: true, count: arr.length });
});

app.listen(PORT, () => {
  console.log(`MingkyPiggy running on http://localhost:${PORT}`);
  if (PIN === "1234") console.warn("[warn] APP_PIN not set — using default '1234'. Set APP_PIN in production!");
});
