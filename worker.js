// ============================================================
//  Cloudflare Worker — server lisensi Roblox + panel admin.
//  Bindings yang dibutuhkan:
//    - KV Namespace bernama: LICENSE_KV
//    - Secret bernama:       ADMIN_KEY
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

      // ---- admin: beri whitelist ----
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

      // ---- admin: cabut / hapus ----
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

      // ---- admin: daftar semua ----
      if (path === "/api/admin/list" && method === "GET") {
        if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
        return json(await loadDB(env));
      }

      // ---- admin: ambil username + avatar dari Roblox (via server, bebas CORS) ----
      if (path === "/api/admin/enrich" && method === "POST") {
        if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
        const { userIds } = await readJson(request);
        if (!Array.isArray(userIds) || userIds.length === 0) return json({});
        const ids = userIds.map((x) => String(x)).filter((x) => /^[0-9]+$/.test(x)).slice(0, 100);
        const out = {};
        // usernames
        try {
          const r = await fetch("https://users.roblox.com/v1/users", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ userIds: ids.map(Number), excludeBannedUsers: false }),
          });
          if (r.ok) {
            const j = await r.json();
            for (const u of (j.data || [])) out[String(u.id)] = { username: u.name, displayName: u.displayName };
          }
        } catch (e) {}
        // avatars
        try {
          const r = await fetch("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" + ids.join(",") + "&size=150x150&format=Png&isCircular=false");
          if (r.ok) {
            const j = await r.json();
            for (const a of (j.data || [])) { out[String(a.targetId)] = out[String(a.targetId)] || {}; out[String(a.targetId)].avatarUrl = a.imageUrl; }
          }
        } catch (e) {}
        return json(out);
      }

      // ---- panel admin ----
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
async function readJson(request) { try { return await request.json(); } catch { return {}; } }
function isAdmin(request, env) { return request.headers.get("x-admin-key") === env.ADMIN_KEY; }
async function loadDB(env) { const raw = await env.LICENSE_KV.get("db"); return raw ? JSON.parse(raw) : {}; }
async function saveDB(env, db) { await env.LICENSE_KV.put("db", JSON.stringify(db)); }
async function groupOwner(id) {
  try {
    const r = await fetch("https://groups.roblox.com/v1/groups/" + id);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.owner ? String(j.owner.userId) : null;
  } catch { return null; }
}
async function authorized(db, productId, creatorId, creatorType) {
  const p = db[productId];
  if (!p) return false;
  creatorId = String(creatorId);
  if (creatorType === "User") { const u = p.users && p.users[creatorId]; return !!u && u.active !== false; }
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
  :root{--b:#111;--muted:#666;--line:#e6e6e6}
  *{box-sizing:border-box}
  body{font-family:system-ui,Arial,sans-serif;max-width:920px;margin:0 auto;padding:24px 16px;color:var(--b)}
  h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:22px 0 8px}
  label{display:block;font-size:13px;margin:10px 0 4px;color:#333}
  input{width:100%;padding:9px;border:1px solid #ccc;border-radius:8px;font-size:14px}
  .row{display:flex;gap:10px;flex-wrap:wrap} .row>div{flex:1;min-width:160px}
  button{padding:9px 13px;border:0;border-radius:8px;font-size:14px;cursor:pointer;margin-top:8px;margin-right:6px}
  .primary{background:#0a7d2c;color:#fff}.danger{background:#b21f1f;color:#fff}.dark{background:#333;color:#fff}.ghost{background:#eee;color:#111}
  .hidden{display:none}
  .err{color:#b21f1f;font-size:13px;margin-top:8px}
  .muted{color:var(--muted);font-size:13px}
  .wrap{display:flex;gap:18px;flex-wrap:wrap}
  .col-prod{flex:0 0 210px} .col-list{flex:1;min-width:300px}
  .pill{display:block;width:100%;text-align:left;background:#f2f2f2;border:1px solid var(--line);border-radius:8px;padding:9px 10px;margin:6px 0;cursor:pointer;font-size:13px}
  .pill.active{background:#111;color:#fff}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
  th,td{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:middle}
  img.av{width:36px;height:36px;border-radius:50%;background:#eee;object-fit:cover;display:block}
  .av.ph{width:36px;height:36px;border-radius:50%;background:#eee}
  .status-on{color:#0a7d2c;font-weight:600}.status-off{color:#b21f1f;font-weight:600}
  .topbar{display:flex;justify-content:space-between;align-items:center}
  .card{border:1px solid var(--line);border-radius:12px;padding:16px;max-width:420px}
</style></head><body>

<div id="login">
  <h1>Panel Lisensi</h1>
  <p class="muted">Masuk dulu untuk mengelola whitelist.</p>
  <div class="card">
    <label>Kunci Admin</label>
    <input id="key" type="password" placeholder="ADMIN_KEY kamu" onkeydown="if(event.key==='Enter')login()"/>
    <button class="primary" onclick="login()">Masuk</button>
    <div id="loginErr" class="err"></div>
  </div>
</div>

<div id="app" class="hidden">
  <div class="topbar">
    <h1>Panel Lisensi</h1>
    <button class="ghost" onclick="logout()">Keluar</button>
  </div>

  <h2>Tambah whitelist</h2>
  <div class="row">
    <div><label>Product ID</label><input id="g_pid" value="loginstreak-v1"/></div>
    <div><label>User ID pembeli</label><input id="g_uid" placeholder="mis. 123456789"/></div>
  </div>
  <div class="row">
    <div><label>Username (catatan, opsional)</label><input id="g_uname" placeholder="NamaPembeli"/></div>
    <div><label>Catatan (opsional)</label><input id="g_note" placeholder="Order #1"/></div>
  </div>
  <button class="primary" onclick="grant()">Beri whitelist</button>
  <span id="grantMsg" class="muted"></span>

  <div class="wrap">
    <div class="col-prod">
      <h2>Produk</h2>
      <div id="products"></div>
    </div>
    <div class="col-list">
      <div class="topbar">
        <h2 id="listTitle">Whitelist</h2>
        <button class="ghost" onclick="loadDB()">Muat ulang</button>
      </div>
      <table>
        <thead><tr><th></th><th></th><th>User</th><th>Status</th><th>Diberikan</th></tr></thead>
        <tbody id="rows"><tr><td colspan="5" class="muted">Pilih produk di kiri.</td></tr></tbody>
      </table>
      <button class="danger" onclick="deleteSelected()">Hapus yang dipilih</button>
      <button class="dark" onclick="deactivateSelected()">Nonaktifkan yang dipilih</button>
      <span id="listMsg" class="muted"></span>
    </div>
  </div>
</div>

<script>
var ADMIN="", DB={}, CUR="";
function H(){return {"Content-Type":"application/json","x-admin-key":ADMIN}}
function esc(s){s=(s==null?"":String(s));return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}

async function login(){
  var k=document.getElementById("key").value;
  var r=await fetch("/api/admin/list",{headers:{"x-admin-key":k}});
  if(r.status===200){ ADMIN=k; DB=await r.json(); document.getElementById("login").classList.add("hidden"); document.getElementById("app").classList.remove("hidden"); renderProducts(); }
  else { document.getElementById("loginErr").textContent="Kunci admin salah."; }
}
function logout(){ ADMIN=""; CUR=""; DB={}; document.getElementById("key").value=""; document.getElementById("app").classList.add("hidden"); document.getElementById("login").classList.remove("hidden"); }

async function loadDB(){ var r=await fetch("/api/admin/list",{headers:H()}); if(r.status!==200){logout();return;} DB=await r.json(); renderProducts(); }

function renderProducts(){
  var pids=Object.keys(DB); var el=document.getElementById("products");
  if(pids.length===0){ el.innerHTML='<p class="muted">Belum ada produk. Beri whitelist pertama untuk membuatnya.</p>'; document.getElementById("rows").innerHTML='<tr><td colspan="5" class="muted">-</td></tr>'; return; }
  if(!CUR || pids.indexOf(CUR)<0) CUR=pids[0];
  var html="";
  for(var i=0;i<pids.length;i++){ var pid=pids[i]; var n=Object.keys((DB[pid]&&DB[pid].users)||{}).length; html+='<button class="pill'+(pid===CUR?" active":"")+'" data-pid="'+esc(pid)+'">'+esc(pid)+' <span class="muted">('+n+')</span></button>'; }
  el.innerHTML=html;
  el.onclick=function(e){ var b=e.target.closest("button[data-pid]"); if(b){ CUR=b.getAttribute("data-pid"); renderProducts(); } };
  renderUsers();
}

async function renderUsers(){
  document.getElementById("listTitle").textContent="Whitelist — "+CUR;
  var users=(DB[CUR]&&DB[CUR].users)||{}; var ids=Object.keys(users);
  var rows=document.getElementById("rows");
  if(ids.length===0){ rows.innerHTML='<tr><td colspan="5" class="muted">Belum ada whitelist untuk produk ini.</td></tr>'; return; }
  rows.innerHTML='<tr><td colspan="5" class="muted">Memuat data Roblox...</td></tr>';
  var info={};
  try{ var r=await fetch("/api/admin/enrich",{method:"POST",headers:H(),body:JSON.stringify({userIds:ids})}); if(r.status===200) info=await r.json(); }catch(e){}
  var html="";
  for(var i=0;i<ids.length;i++){
    var id=ids[i]; var u=users[id]||{}; var meta=info[id]||{};
    var uname=meta.username||u.username||"(tidak diketahui)";
    var av=meta.avatarUrl||"";
    var on=(u.active!==false);
    var when=u.grantedAt?new Date(u.grantedAt).toLocaleString():"-";
    html+='<tr>'
      +'<td><input type="checkbox" class="sel" value="'+esc(id)+'"></td>'
      +'<td>'+(av?'<img class="av" src="'+esc(av)+'">':'<div class="av ph"></div>')+'</td>'
      +'<td><b>'+esc(uname)+'</b><br><span class="muted">'+esc(id)+'</span></td>'
      +'<td>'+(on?'<span class="status-on">aktif</span>':'<span class="status-off">nonaktif</span>')+'</td>'
      +'<td class="muted">'+esc(when)+'</td>'
      +'</tr>';
  }
  rows.innerHTML=html;
}

function selectedIds(){ var out=[]; var xs=document.querySelectorAll(".sel:checked"); for(var i=0;i<xs.length;i++) out.push(xs[i].value); return out; }

async function grant(){
  var body={productId:document.getElementById("g_pid").value,userId:document.getElementById("g_uid").value,username:document.getElementById("g_uname").value,note:document.getElementById("g_note").value};
  var r=await fetch("/api/admin/grant",{method:"POST",headers:H(),body:JSON.stringify(body)});
  var j=await r.json();
  document.getElementById("grantMsg").textContent=j.ok?" Berhasil.":(" Gagal: "+(j.error||""));
  CUR=body.productId; document.getElementById("g_uid").value=""; document.getElementById("g_uname").value=""; document.getElementById("g_note").value="";
  await loadDB();
}
async function deleteSelected(){
  var ids=selectedIds(); if(ids.length===0){ document.getElementById("listMsg").textContent=" Pilih dulu barisnya."; return; }
  if(!confirm("Hapus permanen "+ids.length+" whitelist?")) return;
  for(var i=0;i<ids.length;i++){ await fetch("/api/admin/revoke",{method:"POST",headers:H(),body:JSON.stringify({productId:CUR,userId:ids[i],hard:true})}); }
  document.getElementById("listMsg").textContent=" Terhapus.";
  await loadDB();
}
async function deactivateSelected(){
  var ids=selectedIds(); if(ids.length===0){ document.getElementById("listMsg").textContent=" Pilih dulu barisnya."; return; }
  for(var i=0;i<ids.length;i++){ await fetch("/api/admin/revoke",{method:"POST",headers:H(),body:JSON.stringify({productId:CUR,userId:ids[i]})}); }
  document.getElementById("listMsg").textContent=" Dinonaktifkan.";
  await loadDB();
}
</script>
</body></html>`;
