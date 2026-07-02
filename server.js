// ============================================================
//  Server lisensi + panel admin web — VERSI LOKAL (LEGACY, OPSIONAL).
//
//  CATATAN: Untuk pemakaian sebenarnya, pakai worker.js (Cloudflare Worker).
//  Versi Worker lebih lengkap (produk multi, bot Discord, panel penuh, data
//  permanen di KV) dan itulah yang dibahas di TUTORIAL. File ini hanya untuk
//  uji coba cepat di komputer sendiri; data disimpan di whitelist.json lokal
//  dan formatnya lebih sederhana (satu productId -> users/groups).
//
//  Jalankan lokal:  ADMIN_KEY=kunci-admin-yang-panjang node server.js
//  Panel admin:     http://localhost:3000/admin
// ============================================================

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "GANTI_KUNCI_ADMIN";
const DB_FILE = path.join(__dirname, "whitelist.json");

// whitelist.json: { "<productId>": { users: {id:{...}}, groups:{id:{...}} } }
function load() { try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return {}; } }
function save(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

async function groupOwner(id) {
  try {
    const r = await fetch(`https://groups.roblox.com/v1/groups/${id}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.owner ? String(j.owner.userId) : null;
  } catch { return null; }
}

async function authorized(productId, creatorId, creatorType) {
  const db = load();
  const p = db[productId];
  if (!p) return false;
  creatorId = String(creatorId);
  if (creatorType === "User") {
    const u = p.users && p.users[creatorId];
    return !!u && u.active !== false;
  }
  if (creatorType === "Group") {
    const g = p.groups && p.groups[creatorId];
    if (g && g.active !== false) return true;
    const owner = await groupOwner(creatorId);
    return !!(owner && p.users && p.users[owner] && p.users[owner].active !== false);
  }
  return false;
}

// ---- dipanggil dari dalam game ----
app.post("/api/verify", async (req, res) => {
  const { productId, creatorId, creatorType, nonce } = req.body || {};
  const ok = productId ? await authorized(productId, creatorId, creatorType) : false;
  res.json({ authorized: ok, nonce, ts: Date.now() });
});

// ---- admin ----
function admin(req, res, next) {
  if (req.headers["x-admin-key"] !== ADMIN_KEY) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.post("/api/admin/grant", admin, (req, res) => {
  const { productId, userId, username, note } = req.body || {};
  if (!productId || !userId) return res.status(400).json({ error: "productId & userId wajib" });
  const db = load();
  db[productId] = db[productId] || { users: {}, groups: {} };
  db[productId].users[String(userId)] = {
    username: username || null, note: note || null, active: true,
    grantedAt: new Date().toISOString(),
  };
  save(db);
  res.json({ ok: true });
});

app.post("/api/admin/revoke", admin, (req, res) => {
  const { productId, userId, groupId, hard } = req.body || {};
  const db = load();
  const p = db[productId];
  if (!p) return res.status(404).json({ error: "produk tidak ada" });
  if (userId) { if (hard) delete p.users[String(userId)]; else if (p.users[String(userId)]) p.users[String(userId)].active = false; }
  if (groupId) { if (hard) delete p.groups[String(groupId)]; else if (p.groups[String(groupId)]) p.groups[String(groupId)].active = false; }
  save(db);
  res.json({ ok: true });
});

app.get("/api/admin/list", admin, (req, res) => res.json(load()));

// ---- panel admin web (klik-klik, tanpa terminal) ----
app.get("/admin", (_req, res) => {
  res.type("html").send(ADMIN_HTML);
});

app.get("/", (_req, res) => res.send("License server aktif. Buka /admin untuk panel."));
app.listen(PORT, () => console.log("Server jalan di port " + PORT));

const ADMIN_HTML = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Panel Lisensi</title>
<style>
  :root{--bg:#0f1117;--card:#171a21;--card-2:#1e222b;--line:#2a2f3a;--ink:#e7e9ee;--sub:#9aa2b1}
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px;color:var(--ink);background:var(--bg);min-height:100vh}
  h1{font-size:20px} h2{font-size:16px;margin-top:24px}
  label{display:block;font-size:13px;margin:10px 0 4px;color:var(--sub)}
  input{width:100%;padding:9px;border:1px solid var(--line);border-radius:8px;font-size:14px;background:var(--card-2);color:var(--ink)}
  input::placeholder{color:#5c6475}
  input:focus{outline:2px solid #6366f1;border-color:#6366f1}
  .row{display:flex;gap:10px} .row>div{flex:1}
  button{margin-top:14px;padding:10px 14px;border:0;border-radius:8px;font-size:14px;cursor:pointer;font-weight:600;color:#fff}
  .grant{background:#0a8f4f} .revoke{background:#d92d20} .list{background:#3a3f4b}
  pre{background:var(--card);border:1px solid var(--line);padding:12px;border-radius:8px;overflow:auto;font-size:12px;color:var(--ink)}
  .note{color:var(--sub);font-size:12px;margin-top:6px}
</style></head><body>
<h1>Panel Lisensi</h1>
<label>Kunci Admin (tidak disimpan; ketik ulang tiap buka halaman)</label>
<input id="key" type="password" placeholder="ADMIN_KEY kamu"/>
<div class="row">
  <div><label>Product ID</label><input id="pid" value="loginstreak-v1"/></div>
  <div><label>User ID pembeli</label><input id="uid" placeholder="mis. 123456789"/></div>
</div>
<div class="row">
  <div><label>Username (catatan, opsional)</label><input id="uname" placeholder="NamaPembeli"/></div>
  <div><label>Catatan (opsional)</label><input id="note" placeholder="Order #1"/></div>
</div>
<div class="row">
  <button class="grant" onclick="act('grant')">Beri whitelist</button>
  <button class="revoke" onclick="act('revoke')">Cabut whitelist</button>
  <button class="list" onclick="showList()">Lihat semua</button>
</div>
<p class="note">Cabut = nonaktif. Centang di bawah untuk hapus permanen.</p>
<label><input type="checkbox" id="hard" style="width:auto"/> Hapus permanen saat cabut</label>
<h2>Hasil</h2>
<pre id="out">-</pre>
<script>
function h(){return {"Content-Type":"application/json","x-admin-key":document.getElementById('key').value}}
async function act(kind){
  const body={productId:pid.value,userId:uid.value,username:uname.value,note:note.value};
  if(kind==='revoke') body.hard=document.getElementById('hard').checked;
  const r=await fetch('/api/admin/'+kind,{method:'POST',headers:h(),body:JSON.stringify(body)});
  out.textContent=JSON.stringify(await r.json(),null,2);
}
async function showList(){
  const r=await fetch('/api/admin/list',{headers:h()});
  out.textContent=JSON.stringify(await r.json(),null,2);
}
</script></body></html>`;
