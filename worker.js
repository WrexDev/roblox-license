// ============================================================
//  Cloudflare Worker — server lisensi Roblox.
//  - Tanpa kartu kredit, tanpa GitHub (tempel kode di browser).
//  - Data whitelist disimpan permanen di Cloudflare KV.
//
//  Yang harus kamu siapkan di dashboard Cloudflare (lihat tutorial):
//   1) KV Namespace, di-bind ke Worker ini dengan nama:  LICENSE_KV
//   2) Environment Variable (secret) bernama:            ADMIN_KEY
// ============================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === "/" && method === "GET") {
        return new Response("License server aktif. Buka /admin untuk panel.");
      }

      // ---- dipanggil dari dalam game Roblox ----
      if (path === "/api/verify" && method === "POST") {
        const body = await readJson(request);
        const db = await loadDB(env);
        const ok = body.productId
          ? await authorized(db, body.productId, body.creatorId, body.creatorType)
          : false;
        return json({ authorized: ok, nonce: body.nonce, ts: Date.now() });
      }

      // ---- admin ----
      if (path === "/api/admin/grant" && method === "POST") {
        if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
        const { productId, userId, username, note } = await readJson(request);
        if (!productId || !userId) return json({ error: "productId & userId wajib" }, 400);
        const db = await loadDB(env);
        db[productId] = db[productId] || { users: {}, groups: {} };
        db[productId].users[String(userId)] = {
          username: username || null, note: note || null, active: true,
          grantedAt: new Date().toISOString(),
        };
        await saveDB(env, db);
        return json({ ok: true });
      }

      if (path === "/api/admin/revoke" && method === "POST") {
        if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
        const { productId, userId, groupId, hard } = await readJson(request);
        const db = await loadDB(env);
        const p = db[productId];
        if (!p) return json({ error: "produk tidak ada" }, 404);
        if (userId) { if (hard) delete p.users[String(userId)]; else if (p.users[String(userId)]) p.users[String(userId)].active = false; }
        if (groupId) { if (hard) delete p.groups[String(groupId)]; else if (p.groups[String(groupId)]) p.groups[String(groupId)].active = false; }
        await saveDB(env, db);
        return json({ ok: true });
      }

      if (path === "/api/admin/list" && method === "GET") {
        if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
        return json(await loadDB(env));
      }

      // ---- panel admin (klik-klik, tanpa terminal) ----
      if (path === "/admin" && method === "GET") {
        return new Response(ADMIN_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  },
};

// ---------- util ----------
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}
function isAdmin(request, env) {
  return request.headers.get("x-admin-key") === env.ADMIN_KEY;
}
async function loadDB(env) {
  const raw = await env.LICENSE_KV.get("db");
  return raw ? JSON.parse(raw) : {};
}
async function saveDB(env, db) {
  await env.LICENSE_KV.put("db", JSON.stringify(db));
}
async function groupOwner(id) {
  try {
    const r = await fetch(`https://groups.roblox.com/v1/groups/${id}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.owner ? String(j.owner.userId) : null;
  } catch { return null; }
}
async function authorized(db, productId, creatorId, creatorType) {
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

// ---------- halaman panel admin ----------
const ADMIN_HTML = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Panel Lisensi</title>
<style>
  body{font-family:system-ui,Arial,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#111}
  h1{font-size:20px} h2{font-size:16px;margin-top:24px}
  label{display:block;font-size:13px;margin:10px 0 4px;color:#333}
  input{width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;font-size:14px;box-sizing:border-box}
  .row{display:flex;gap:10px} .row>div{flex:1}
  button{margin-top:14px;padding:10px 14px;border:0;border-radius:8px;font-size:14px;cursor:pointer}
  .grant{background:#0a7d2c;color:#fff} .revoke{background:#b21f1f;color:#fff} .list{background:#333;color:#fff}
  pre{background:#f5f5f5;padding:12px;border-radius:8px;overflow:auto;font-size:12px}
  .note{color:#666;font-size:12px;margin-top:6px}
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
