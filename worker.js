// ============================================================
//  Cloudflare Worker — server lisensi Roblox + panel admin + bot Discord.
//  Bindings: KV Namespace "LICENSE_KV".
//  Secrets:
//    ADMIN_KEY            (wajib)  - kunci masuk panel admin.
//    DISCORD_PUBLIC_KEY   (opsional, wajib untuk command /own)
//    DISCORD_BOT_TOKEN    (opsional, wajib untuk command /own)
//    DISCORD_APPLICATION_ID (opsional, wajib untuk command /own)
//  Struktur data KV:
//    { products: { <pid>: { name, createdAt, users:{}, groups:{} } },
//      settings: { discordWebhook, discordBotName, discordBotAvatar } }
// ============================================================

export default {
  async fetch(request, env, ctx) {
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

      // ---- endpoint publik untuk bot Discord (Interactions Endpoint URL) ----
      if (path === "/discord/interactions" && method === "POST") {
        return handleDiscordInteraction(request, env, ctx);
      }

      // ---- semua endpoint admin butuh kunci admin ----
      if (path.startsWith("/api/admin/")) {
        if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401);
      }

      // ---- admin: daftar semua (produk + settings) ----
      if (path === "/api/admin/list" && method === "GET") {
        return json(await loadDB(env));
      }

      // ---- admin: buat produk baru (pid = kode acak) ----
      if (path === "/api/admin/product/create" && method === "POST") {
        const { name } = await readJson(request);
        const nm = (name || "").trim();
        if (!nm) return json({ error: "nama produk wajib" }, 400);
        const db = await loadDB(env);
        let pid = genId();
        while (db.products[pid]) pid = genId();
        db.products[pid] = { name: nm, createdAt: new Date().toISOString(), users: {}, groups: {} };
        await saveDB(env, db);
        return json({ ok: true, productId: pid });
      }

      // ---- admin: hapus produk (beserta seluruh whitelistnya) ----
      if (path === "/api/admin/product/delete" && method === "POST") {
        const { productId } = await readJson(request);
        const db = await loadDB(env);
        if (!db.products[productId]) return json({ error: "produk tidak ada" }, 404);
        delete db.products[productId];
        await saveDB(env, db);
        return json({ ok: true });
      }

      // ---- admin: cari tahu username/ID Roblox itu valid & terdaftar atau tidak ----
      if (path === "/api/admin/resolve" && method === "POST") {
        const { input } = await readJson(request);
        const r = await resolveTarget(input);
        return json(r);
      }

      // ---- admin: beri whitelist (username otomatis dari Roblox) ----
      if (path === "/api/admin/grant" && method === "POST") {
        let { productId, userId, username, note } = await readJson(request);
        if (!productId || !userId) return json({ error: "productId & userId wajib" }, 400);
        const db = await loadDB(env);
        const p = db.products[productId];
        if (!p) return json({ error: "produk tidak ada" }, 404);
        if (!username) username = await fetchUsername(userId);
        const existing = p.users[String(userId)] || {};
        const isNew = !existing.grantedAt;
        p.users[String(userId)] = {
          username: username || existing.username || null,
          note: note || existing.note || null,
          active: true,
          grantedAt: existing.grantedAt || new Date().toISOString(),
        };
        await saveDB(env, db);
        if (isNew) {
          // log ke Discord hanya untuk ID yang benar-benar baru
          await notifyDiscord(db, p, productId, String(userId), username).catch(() => {});
        }
        return json({ ok: true, username: username || null, isNew });
      }

      // ---- admin: aktifkan / nonaktifkan satu whitelist ----
      if (path === "/api/admin/toggle" && method === "POST") {
        const { productId, userId, active } = await readJson(request);
        const db = await loadDB(env);
        const p = db.products[productId];
        if (!p || !p.users[String(userId)]) return json({ error: "tidak ada" }, 404);
        p.users[String(userId)].active = !!active;
        await saveDB(env, db);
        return json({ ok: true });
      }

      // ---- admin: cabut / hapus permanen ----
      if (path === "/api/admin/revoke" && method === "POST") {
        const { productId, userId, groupId, hard } = await readJson(request);
        const db = await loadDB(env);
        const p = db.products[productId];
        if (!p) return json({ error: "produk tidak ada" }, 404);
        if (userId) { if (hard) delete p.users[String(userId)]; else if (p.users[String(userId)]) p.users[String(userId)].active = false; }
        if (groupId) { if (hard) delete p.groups[String(groupId)]; else if (p.groups[String(groupId)]) p.groups[String(groupId)].active = false; }
        await saveDB(env, db);
        return json({ ok: true });
      }

      // ---- admin: ambil username + avatar dari Roblox (via server, bebas CORS) ----
      if (path === "/api/admin/enrich" && method === "POST") {
        const { userIds } = await readJson(request);
        if (!Array.isArray(userIds) || userIds.length === 0) return json({});
        const ids = userIds.map((x) => String(x)).filter((x) => /^[0-9]+$/.test(x)).slice(0, 100);
        if (ids.length === 0) return json({});
        const out = {};
        try {
          const r = await fetch("https://users.roblox.com/v1/users", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ userIds: ids.map(Number), excludeBannedUsers: false }),
          });
          if (r.ok) { const j = await r.json(); for (const u of (j.data || [])) out[String(u.id)] = { username: u.name, displayName: u.displayName }; }
        } catch (e) {}
        try {
          const r = await fetch("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" + ids.join(",") + "&size=150x150&format=Png&isCircular=false");
          if (r.ok) { const j = await r.json(); for (const a of (j.data || [])) { out[String(a.targetId)] = out[String(a.targetId)] || {}; out[String(a.targetId)].avatarUrl = a.imageUrl; } }
        } catch (e) {}
        return json(out);
      }

      // ---- admin: baca / simpan pengaturan (webhook + identitas bot Discord) ----
      if (path === "/api/admin/settings" && method === "GET") {
        const db = await loadDB(env);
        const s = db.settings || {};
        return json({
          discordWebhook: s.discordWebhook || "",
          discordBotName: s.discordBotName || "",
          discordBotAvatar: s.discordBotAvatar || "",
          hasSlashCommandSecrets: !!(env.DISCORD_APPLICATION_ID && env.DISCORD_BOT_TOKEN && env.DISCORD_PUBLIC_KEY),
        });
      }
      if (path === "/api/admin/settings" && method === "POST") {
        const { discordWebhook, discordBotName, discordBotAvatar } = await readJson(request);
        const db = await loadDB(env);
        db.settings = db.settings || {};
        if (discordWebhook !== undefined) db.settings.discordWebhook = (discordWebhook || "").trim();
        if (discordBotName !== undefined) db.settings.discordBotName = (discordBotName || "").trim();
        if (discordBotAvatar !== undefined) db.settings.discordBotAvatar = (discordBotAvatar || "").trim();
        await saveDB(env, db);
        return json({ ok: true });
      }

      // ---- admin: daftarkan command /own ke Discord (sekali klik) ----
      if (path === "/api/admin/discord/register-command" && method === "POST") {
        if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_BOT_TOKEN) {
          return json({ error: "Secret DISCORD_APPLICATION_ID / DISCORD_BOT_TOKEN belum diset di Cloudflare." }, 400);
        }
        const cmd = [{
          name: "own",
          description: "Lihat produk yang lisensinya kamu miliki",
          options: [{ name: "akun", description: "Username atau User ID Roblox kamu", type: 3, required: true }],
        }];
        try {
          const r = await fetch("https://discord.com/api/v10/applications/" + env.DISCORD_APPLICATION_ID + "/commands", {
            method: "PUT",
            headers: { authorization: "Bot " + env.DISCORD_BOT_TOKEN, "content-type": "application/json" },
            body: JSON.stringify(cmd),
          });
          if (!r.ok) { const t = await r.text(); return json({ error: "Discord menolak: " + t }, 400); }
          return json({ ok: true });
        } catch (e) { return json({ error: String(e) }, 500); }
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

function genId() {
  const c = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  const a = crypto.getRandomValues(new Uint8Array(12));
  for (let i = 0; i < 12; i++) s += c[a[i] % c.length];
  return s;
}

async function loadDB(env) {
  const raw = await env.LICENSE_KV.get("db");
  let db = raw ? JSON.parse(raw) : {};
  // migrasi dari format lama (produk sebagai key paling atas) -> { products, settings }
  if (!db.products) {
    const products = {};
    for (const k of Object.keys(db)) {
      if (k === "products" || k === "settings") continue;
      const v = db[k];
      if (v && (v.users || v.groups)) {
        products[k] = { name: k, createdAt: new Date().toISOString(), users: v.users || {}, groups: v.groups || {} };
      }
    }
    db = { products, settings: db.settings || {} };
  }
  if (!db.settings) db.settings = {};
  return db;
}
async function saveDB(env, db) { await env.LICENSE_KV.put("db", JSON.stringify(db)); }

async function fetchUsername(id) {
  try {
    const r = await fetch("https://users.roblox.com/v1/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userIds: [Number(id)], excludeBannedUsers: false }),
    });
    if (r.ok) { const j = await r.json(); if (j.data && j.data[0]) return j.data[0].name; }
  } catch (e) {}
  return null;
}
async function fetchAvatar(id) {
  try {
    const r = await fetch("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" + id + "&size=150x150&format=Png&isCircular=false");
    if (r.ok) { const j = await r.json(); if (j.data && j.data[0]) return j.data[0].imageUrl; }
  } catch (e) {}
  return null;
}
async function groupOwner(id) {
  try {
    const r = await fetch("https://groups.roblox.com/v1/groups/" + id);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.owner ? String(j.owner.userId) : null;
  } catch { return null; }
}
async function authorized(db, productId, creatorId, creatorType) {
  const p = db.products && db.products[productId];
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

// ---------- ubah username ATAU User ID jadi identitas Roblox lengkap ----------
async function resolveTarget(input) {
  input = String(input == null ? "" : input).trim();
  if (!input) return { found: false };
  if (/^[0-9]+$/.test(input)) {
    const uname = await fetchUsername(input);
    if (!uname) return { found: false };
    const avatarUrl = await fetchAvatar(input);
    return { found: true, userId: input, username: uname, avatarUrl: avatarUrl || null };
  }
  try {
    const r = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ usernames: [input], excludeBannedUsers: false }),
    });
    if (r.ok) {
      const j = await r.json();
      if (j.data && j.data[0]) {
        const id = String(j.data[0].id);
        const avatarUrl = await fetchAvatar(id);
        return { found: true, userId: id, username: j.data[0].name, avatarUrl: avatarUrl || null };
      }
    }
  } catch (e) {}
  return { found: false };
}

// ---------- kirim log ke Discord (webhook) ----------
async function notifyDiscord(db, product, pid, userId, username) {
  const hook = db.settings && db.settings.discordWebhook;
  if (!hook) return;
  const avatar = await fetchAvatar(userId);
  const botName = (db.settings && db.settings.discordBotName) || "License Log";
  const botAvatar = (db.settings && db.settings.discordBotAvatar) || undefined;
  const payload = {
    username: botName,
    avatar_url: botAvatar,
    embeds: [{
      title: "Whitelist baru ditambahkan",
      color: 3066993,
      thumbnail: avatar ? { url: avatar } : undefined,
      fields: [
        { name: "Produk", value: "➤ " + (product.name || "Produk"), inline: true },
        { name: "User", value: (username || "(tidak diketahui)") + "\n`" + userId + "`", inline: true },
        { name: "Profil", value: "https://www.roblox.com/users/" + userId + "/profile", inline: false },
      ],
      timestamp: new Date().toISOString(),
    }],
  };
  await fetch(hook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ---------- bot Discord: command /own ----------
function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  return arr;
}
async function verifyDiscordSignature(bodyText, sigHex, tsRaw, publicKeyHex) {
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    const data = new TextEncoder().encode(tsRaw + bodyText);
    const sig = hexToBytes(sigHex);
    return await crypto.subtle.verify("Ed25519", key, sig, data);
  } catch (e) { return false; }
}

async function handleDiscordInteraction(request, env, ctx) {
  const sig = request.headers.get("x-signature-ed25519");
  const ts = request.headers.get("x-signature-timestamp");
  const bodyText = await request.text();
  if (!sig || !ts || !env.DISCORD_PUBLIC_KEY) return new Response("unauthorized", { status: 401 });
  const valid = await verifyDiscordSignature(bodyText, sig, ts, env.DISCORD_PUBLIC_KEY);
  if (!valid) return new Response("invalid signature", { status: 401 });

  let body;
  try { body = JSON.parse(bodyText); } catch { return new Response("bad request", { status: 400 }); }

  if (body.type === 1) return json({ type: 1 }); // PING dari Discord

  if (body.type === 2 && body.data && body.data.name === "own") {
    const opt = (body.data.options || []).find((o) => o.name === "akun");
    const target = opt ? String(opt.value) : "";
    const appId = env.DISCORD_APPLICATION_ID || body.application_id;
    ctx.waitUntil(handleOwnCommand(env, appId, body.token, target));
    // Balasan langsung "sedang diproses" (otomatis tampil sebagai reply ke command user).
    return json({ type: 5 });
  }

  return json({ type: 4, data: { content: "Command tidak dikenal." } });
}

async function handleOwnCommand(env, appId, token, target) {
  let content;
  try {
    const resolved = await resolveTarget(target);
    if (!resolved.found) {
      content = "Tidak ditemukan akun Roblox untuk `" + target + "`. Pastikan username atau User ID benar.";
    } else {
      const db = await loadDB(env);
      const owned = [];
      for (const pid of Object.keys(db.products || {})) {
        const p = db.products[pid];
        const u = p.users && p.users[resolved.userId];
        if (u) owned.push({ name: p.name || "Produk", active: u.active !== false });
      }
      const header = "**" + resolved.username + "** (`" + resolved.userId + "`)";
      if (owned.length === 0) {
        content = header + "\nBelum memiliki lisensi produk apa pun.";
      } else {
        const lines = owned.map((o) => "➤ " + o.name + (o.active ? "" : " _(nonaktif)_"));
        content = header + "\n" + lines.join("\n");
      }
    }
  } catch (e) {
    content = "Terjadi kesalahan saat memeriksa lisensi. Coba lagi.";
  }
  try {
    await fetch("https://discord.com/api/v10/webhooks/" + appId + "/" + token + "/messages/@original", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch (e) {}
}

// ---------- halaman panel admin ----------
const ADMIN_HTML = `<!doctype html>
<html lang="id"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Panel Lisensi</title>
<style>
  :root{
    --ink:#1a1d23; --sub:#68707d; --line:#e4e7ec; --bg:#f6f7f9; --card:#ffffff;
    --accent:#4f46e5; --accent-ink:#3730a3; --accent-soft:#eef0fe;
    --ok:#0a8f4f; --ok-soft:#e7f7ee; --bad:#d92d20; --bad-soft:#fdeceb;
    --side-bg:#14161f; --side-ink:#c7cad4; --side-active:#232637;
    --radius:12px;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh}
  code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  h1{font-size:17px;margin:0;font-weight:700}
  h2{font-size:13px;margin:0 0 12px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:var(--sub)}
  h3{font-size:16px;margin:0;font-weight:700}
  p{margin:0}
  label{display:block;font-size:12.5px;margin:0 0 5px;color:var(--sub);font-weight:600}
  input{width:100%;padding:10px 11px;border:1px solid var(--line);border-radius:9px;font-size:14px;background:#fff;color:var(--ink)}
  input:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
  .field{margin-bottom:12px}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  .row>div{flex:1;min-width:170px}
  button{padding:9px 14px;border:0;border-radius:9px;font-size:13.5px;cursor:pointer;font-weight:600;font-family:inherit}
  button:disabled{opacity:.5;cursor:not-allowed}
  .primary{background:var(--accent);color:#fff}
  .primary:hover:not(:disabled){background:var(--accent-ink)}
  .danger{background:var(--bad-soft);color:var(--bad)}
  .danger:hover:not(:disabled){background:#f9d8d5}
  .ghost{background:#fff;color:var(--ink);border:1px solid var(--line)}
  .ghost:hover:not(:disabled){background:#f2f3f5}
  .dark{background:var(--ink);color:#fff}
  .hidden{display:none !important}
  .err{color:var(--bad);font-size:12.5px;margin-top:8px}
  .ok{color:var(--ok);font-size:12.5px;margin-top:8px}
  .muted{color:var(--sub);font-size:12.5px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:18px}
  .card + .card{margin-top:14px}
  .spacer{margin-top:12px}
  .badge{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:100px;font-size:11.5px;font-weight:700}
  .badge.ok{background:var(--ok-soft);color:var(--ok)}
  .badge.bad{background:var(--bad-soft);color:var(--bad)}
  .badge.neutral{background:var(--accent-soft);color:var(--accent-ink)}

  /* ---- login ---- */
  #login{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  #login .card{width:100%;max-width:360px}
  #login h1{font-size:20px;margin-bottom:4px}

  /* ---- shell ---- */
  #app{display:flex;min-height:100vh}
  .side{width:220px;flex:0 0 220px;background:var(--side-bg);color:var(--side-ink);padding:18px 12px;display:flex;flex-direction:column;gap:4px}
  .side .brand{color:#fff;font-weight:800;font-size:15px;padding:6px 10px 18px}
  .side button.nav{all:unset;box-sizing:border-box;width:100%;padding:10px 12px;border-radius:9px;font-size:13.5px;font-weight:600;cursor:pointer;color:var(--side-ink)}
  .side button.nav:hover{background:#1c1f2c}
  .side button.nav.active{background:var(--side-active);color:#fff}
  .side .foot{margin-top:auto;padding-top:12px}
  .side .foot button{width:100%}

  .main{flex:1;min-width:0;padding:26px 30px;max-width:1120px}
  .topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
  .view{display:none}
  .view.active{display:block}

  /* ---- produk & whitelist ---- */
  .wrap{display:flex;gap:16px;align-items:flex-start}
  .col-prod{flex:0 0 260px}
  .col-list{flex:1;min-width:0}
  .pill{display:block;width:100%;text-align:left;background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;font-size:13px;line-height:1.4}
  .pill:hover{border-color:#c7cbd4}
  .pill.active{background:var(--ink);border-color:var(--ink);color:#fff}
  .pill .pn{font-weight:700;font-size:13px}
  .pill code{font-size:11px;opacity:.7}

  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:4px}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:var(--sub);text-align:left;padding:0 6px 8px;font-weight:700}
  td{border-top:1px solid var(--line);padding:9px 6px;text-align:left;vertical-align:middle}
  img.av{width:34px;height:34px;border-radius:50%;background:#eee;object-fit:cover;display:block}
  .av.ph{width:34px;height:34px;border-radius:50%;background:#eee}
  .topline{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
  .pidline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
  .pidline code{background:#f2f3f5;padding:3px 8px;border-radius:6px;font-size:12.5px}
  .tgl{border:1px solid var(--line);border-radius:20px;padding:5px 12px;font-size:12px;cursor:pointer;font-weight:600}
  .tgl.on{background:var(--ok-soft);color:var(--ok);border-color:#c7ecd8}
  .tgl.off{background:var(--bad-soft);color:var(--bad);border-color:#f6c9c4}
  .xbtn{background:none;color:var(--bad);border:1px solid #f6c9c4;border-radius:8px;padding:5px 9px;font-size:12px;cursor:pointer;font-weight:600}
  .toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 4px}
  .toolbar input{flex:1;min-width:180px}

  .resolve-box{border:1px dashed var(--line);border-radius:9px;padding:10px 12px;margin-top:8px;font-size:13px;display:flex;align-items:center;gap:10px}
  .resolve-box.empty{color:var(--sub);border-style:dashed}
  .resolve-box.good{border-color:#c7ecd8;background:var(--ok-soft)}
  .resolve-box.bad{border-color:#f6c9c4;background:var(--bad-soft);color:var(--bad)}

  @media (max-width:820px){
    #app{flex-direction:column}
    .side{width:100%;flex:none;flex-direction:row;overflow-x:auto;padding:10px}
    .side .brand{display:none}
    .side .foot{margin-top:0}
    .main{padding:18px}
    .wrap{flex-direction:column}
    .col-prod{flex:none;width:100%}
  }
</style></head><body>

<div id="login">
  <div class="card">
    <h1>Panel Lisensi</h1>
    <p class="muted spacer">Masuk untuk mengelola produk &amp; whitelist.</p>
    <div class="field spacer">
      <label>Kunci Admin</label>
      <input id="key" type="password" placeholder="ADMIN_KEY kamu" onkeydown="if(event.key==='Enter')login()"/>
    </div>
    <button class="primary" style="width:100%" onclick="login()">Masuk</button>
    <div id="loginErr" class="err"></div>
  </div>
</div>

<div id="app" class="hidden">
  <div class="side">
    <div class="brand">Panel Lisensi</div>
    <button class="nav active" data-view="produk" onclick="showView('produk')">Produk &amp; Whitelist</button>
    <button class="nav" data-view="pengaturan" onclick="showView('pengaturan')">Pengaturan Discord</button>
    <div class="foot"><button class="ghost" onclick="logout()">Keluar</button></div>
  </div>

  <div class="main">

    <!-- ===== VIEW: PRODUK & WHITELIST ===== -->
    <div id="view-produk" class="view active">
      <div class="topbar"><h3>Produk &amp; Whitelist</h3></div>

      <div class="card">
        <h2>Buat produk baru</h2>
        <div class="row">
          <div><input id="np_name" placeholder="Nama produk, mis. Music System"/></div>
          <div style="flex:0 0 auto"><button class="primary" onclick="createProduct()">Buat produk</button></div>
        </div>
        <div id="createMsg" class="muted"></div>
      </div>

      <div class="wrap spacer">
        <div class="col-prod">
          <div class="card">
            <h2>Produk</h2>
            <input id="prodSearch" placeholder="Cari produk..." oninput="renderProducts()"/>
            <div id="products" style="margin-top:10px"></div>
          </div>
        </div>

        <div class="col-list">
          <div id="noProd" class="card muted">Pilih atau buat produk dulu.</div>

          <div id="prodPanel" class="hidden">
            <div class="card">
              <div class="topline">
                <div>
                  <h3 id="pTitle">-</h3>
                  <div class="pidline">
                    <span class="muted">ID:</span><code id="pPid">-</code>
                    <button class="ghost" onclick="copyText(document.getElementById('pPid').textContent,this)">Salin ID</button>
                  </div>
                </div>
                <div style="display:flex;gap:8px">
                  <button class="dark" onclick="copySnippet()">Salin snippet</button>
                  <button class="danger" onclick="deleteProduct()">Hapus produk</button>
                </div>
              </div>
              <div class="muted spacer" id="pCreated"></div>
            </div>

            <div class="card">
              <h2>Tambah whitelist</h2>
              <div class="row">
                <div>
                  <label>Username atau User ID Roblox</label>
                  <input id="g_input" placeholder="mis. paksatpam_9 atau 123456789" oninput="onTargetInput()"/>
                </div>
                <div style="flex:0 0 auto;align-self:flex-end">
                  <button class="ghost" id="validateBtn" onclick="validateTarget()">Validasi</button>
                </div>
              </div>
              <div id="resolveBox" class="resolve-box empty">Isi username/ID lalu klik Validasi untuk memastikan akunnya benar.</div>
              <div class="field spacer">
                <label>Catatan (opsional, tidak dikirim ke Discord)</label>
                <input id="g_note" placeholder="Order #1"/>
              </div>
              <button class="primary" id="grantBtn" onclick="grant()" disabled>Beri whitelist</button>
              <span id="grantMsg" class="muted"></span>
            </div>

            <div class="card">
              <div class="topline">
                <h2 style="margin:0">Daftar whitelist</h2>
                <button class="ghost" onclick="loadDB()">Muat ulang</button>
              </div>
              <div class="toolbar">
                <input id="userSearch" placeholder="Cari username / ID..." oninput="renderUsers()"/>
                <button class="danger" onclick="deleteSelected()">Hapus yang dipilih</button>
              </div>
              <table>
                <thead><tr><th></th><th></th><th>User</th><th>Status</th><th>Diberikan</th><th></th></tr></thead>
                <tbody id="rows"><tr><td colspan="6" class="muted">-</td></tr></tbody>
              </table>
              <div id="listMsg" class="muted"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== VIEW: PENGATURAN ===== -->
    <div id="view-pengaturan" class="view">
      <div class="topbar"><h3>Pengaturan Discord</h3></div>

      <div class="card">
        <h2>Identitas bot webhook</h2>
        <p class="muted">Nama &amp; ikon yang tampil saat log whitelist dikirim ke channel Discord-mu.</p>
        <div class="row spacer">
          <div><label>Nama bot</label><input id="bot_name" placeholder="mis. License Log"/></div>
          <div><label>URL ikon bot (opsional)</label><input id="bot_avatar" placeholder="https://.../icon.png"/></div>
        </div>
        <div class="field spacer">
          <label>Webhook URL channel Discord</label>
          <input id="hook" placeholder="https://discord.com/api/webhooks/..."/>
        </div>
        <button class="primary" onclick="saveSettings()">Simpan pengaturan</button>
        <span id="settingsMsg" class="muted"></span>
      </div>

      <div class="card">
        <h2>Command /own (bot interaktif)</h2>
        <p class="muted">Anggota Discord bisa ketik <code>/own username_atau_id</code> untuk melihat produk apa yang lisensinya mereka miliki. Bot akan membalas langsung di bawah command mereka.</p>
        <ol class="muted" style="padding-left:18px;line-height:1.7">
          <li>Buat Discord Application di <code>discord.com/developers/applications</code>, tambahkan Bot, undang ke server.</li>
          <li>Set <b>Interactions Endpoint URL</b> aplikasi ke: <code id="interactUrl">-</code></li>
          <li>Tambahkan 3 secret di Cloudflare: <code>DISCORD_PUBLIC_KEY</code>, <code>DISCORD_BOT_TOKEN</code>, <code>DISCORD_APPLICATION_ID</code>.</li>
          <li>Klik tombol di bawah untuk mendaftarkan command <code>/own</code>.</li>
        </ol>
        <div id="secretStatus" class="badge neutral">Memeriksa secret...</div>
        <div class="spacer"><button class="primary" onclick="registerCommand()">Daftarkan command /own</button> <span id="cmdMsg" class="muted"></span></div>
      </div>
    </div>

  </div>
</div>

<script>
var ADMIN="", DB={products:{},settings:{}}, CUR="", uidTimer=null, INFO={}, VALIDATED=null;
var NL=String.fromCharCode(10);
function H(){return {"Content-Type":"application/json","x-admin-key":ADMIN}}
function esc(s){s=(s==null?"":String(s));return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function products(){return (DB&&DB.products)||{}}

function showView(v){
  document.querySelectorAll(".view").forEach(function(el){el.classList.remove("active");});
  document.getElementById("view-"+v).classList.add("active");
  document.querySelectorAll(".side button.nav").forEach(function(b){b.classList.toggle("active", b.getAttribute("data-view")===v);});
}

async function login(){
  var k=document.getElementById("key").value;
  var r=await fetch("/api/admin/list",{headers:{"x-admin-key":k}});
  if(r.status===200){
    ADMIN=k; DB=await r.json();
    if(!DB.products) DB.products={}; if(!DB.settings) DB.settings={};
    document.getElementById("login").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    document.getElementById("interactUrl").textContent = location.origin + "/discord/interactions";
    attachRowHandler();
    renderProducts();
    await loadSettings();
  } else {
    document.getElementById("loginErr").textContent="Kunci admin salah.";
  }
}
function logout(){ ADMIN=""; CUR=""; DB={products:{},settings:{}}; document.getElementById("key").value=""; document.getElementById("app").classList.add("hidden"); document.getElementById("login").classList.remove("hidden"); }

async function loadDB(){
  var r=await fetch("/api/admin/list",{headers:H()});
  if(r.status!==200){logout();return;}
  DB=await r.json();
  if(!DB.products) DB.products={}; if(!DB.settings) DB.settings={};
  renderProducts();
}

async function loadSettings(){
  var r=await fetch("/api/admin/settings",{headers:H()});
  if(r.status!==200) return;
  var j=await r.json();
  document.getElementById("hook").value=j.discordWebhook||"";
  document.getElementById("bot_name").value=j.discordBotName||"";
  document.getElementById("bot_avatar").value=j.discordBotAvatar||"";
  var st=document.getElementById("secretStatus");
  if(j.hasSlashCommandSecrets){ st.textContent="Secret bot sudah lengkap"; st.className="badge ok"; }
  else { st.textContent="Secret bot belum lengkap"; st.className="badge bad"; }
}

async function saveSettings(){
  var body={
    discordWebhook: document.getElementById("hook").value.trim(),
    discordBotName: document.getElementById("bot_name").value.trim(),
    discordBotAvatar: document.getElementById("bot_avatar").value.trim(),
  };
  var r=await fetch("/api/admin/settings",{method:"POST",headers:H(),body:JSON.stringify(body)});
  document.getElementById("settingsMsg").textContent = r.status===200 ? " Tersimpan." : " Gagal menyimpan.";
  if(r.status===200) DB.settings=Object.assign(DB.settings||{}, body);
}

async function registerCommand(){
  document.getElementById("cmdMsg").textContent=" Mendaftarkan...";
  var r=await fetch("/api/admin/discord/register-command",{method:"POST",headers:H()});
  var j=await r.json();
  document.getElementById("cmdMsg").textContent = j.ok ? " Berhasil didaftarkan. Coba /own di server Discord-mu." : (" Gagal: "+(j.error||""));
}

async function createProduct(){
  var name=document.getElementById("np_name").value.trim();
  if(!name){ document.getElementById("createMsg").textContent=" Nama produk wajib diisi."; return; }
  var r=await fetch("/api/admin/product/create",{method:"POST",headers:H(),body:JSON.stringify({name:name})});
  var j=await r.json();
  if(j.ok){ document.getElementById("np_name").value=""; document.getElementById("createMsg").textContent=" Produk dibuat."; CUR=j.productId; await loadDB(); }
  else { document.getElementById("createMsg").textContent=" Gagal: "+(j.error||""); }
}

function renderProducts(){
  var pids=Object.keys(products());
  var q=(document.getElementById("prodSearch").value||"").toLowerCase().trim();
  if(q) pids=pids.filter(function(pid){ var p=products()[pid]||{}; return pid.toLowerCase().indexOf(q)>=0 || (p.name||"").toLowerCase().indexOf(q)>=0; });
  var el=document.getElementById("products");
  if(Object.keys(products()).length===0){ el.innerHTML='<p class="muted">Belum ada produk. Buat dulu di atas.</p>'; showPanel(false); return; }
  if(pids.length===0){ el.innerHTML='<p class="muted">Tidak ada produk cocok.</p>'; }
  if(!CUR || !products()[CUR]){ var all=Object.keys(products()); CUR=all.length?all[0]:""; }
  var html="";
  for(var i=0;i<pids.length;i++){
    var pid=pids[i]; var p=products()[pid]||{}; var n=Object.keys(p.users||{}).length;
    html+='<button class="pill'+(pid===CUR?" active":"")+'" data-pid="'+esc(pid)+'">'
      +'<div class="pn">'+esc(p.name||pid)+' <span class="muted">('+n+')</span></div>'
      +'<code>'+esc(pid)+'</code></button>';
  }
  el.innerHTML=html;
  el.onclick=function(e){ var b=e.target.closest("button[data-pid]"); if(b){ CUR=b.getAttribute("data-pid"); document.getElementById("userSearch").value=""; resetTargetInput(); renderProducts(); } };
  renderProductPanel();
}

function showPanel(on){ document.getElementById("prodPanel").classList.toggle("hidden",!on); document.getElementById("noProd").classList.toggle("hidden",on); }

function renderProductPanel(){
  if(!CUR || !products()[CUR]){ showPanel(false); return; }
  showPanel(true);
  var p=products()[CUR];
  document.getElementById("pTitle").textContent=p.name||CUR;
  document.getElementById("pPid").textContent=CUR;
  document.getElementById("pCreated").textContent="Dibuat: "+(p.createdAt?new Date(p.createdAt).toLocaleString():"-");
  renderUsers();
}

async function renderUsers(){
  var p=products()[CUR]; if(!p){ return; }
  var users=p.users||{}; var ids=Object.keys(users);
  var rows=document.getElementById("rows");
  if(ids.length===0){ rows.innerHTML='<tr><td colspan="6" class="muted">Belum ada whitelist untuk produk ini.</td></tr>'; return; }
  var need=ids.filter(function(id){ return !INFO[id]; });
  if(need.length){
    rows.innerHTML='<tr><td colspan="6" class="muted">Memuat data Roblox...</td></tr>';
    try{ var r=await fetch("/api/admin/enrich",{method:"POST",headers:H(),body:JSON.stringify({userIds:need})}); if(r.status===200){ var got=await r.json(); for(var k in got) INFO[k]=got[k]; } }catch(e){}
  }
  var q=(document.getElementById("userSearch").value||"").toLowerCase().trim();
  var html="";
  for(var i=0;i<ids.length;i++){
    var id=ids[i]; var u=users[id]||{}; var meta=INFO[id]||{};
    var uname=meta.username||u.username||"(tidak diketahui)";
    if(q && uname.toLowerCase().indexOf(q)<0 && id.indexOf(q)<0) continue;
    var av=meta.avatarUrl||"";
    var on=(u.active!==false);
    var when=u.grantedAt?new Date(u.grantedAt).toLocaleString():"-";
    var tgl = on
      ? '<button class="tgl on" data-act="toggle" data-id="'+esc(id)+'" data-to="0">Nonaktifkan</button>'
      : '<button class="tgl off" data-act="toggle" data-id="'+esc(id)+'" data-to="1">Aktifkan</button>';
    html+='<tr>'
      +'<td><input type="checkbox" class="sel" value="'+esc(id)+'"></td>'
      +'<td>'+(av?'<img class="av" src="'+esc(av)+'">':'<div class="av ph"></div>')+'</td>'
      +'<td><b>'+esc(uname)+'</b><br><span class="muted">'+esc(id)+'</span></td>'
      +'<td>'+(on?'<span class="badge ok">aktif</span>':'<span class="badge bad">nonaktif</span>')+'</td>'
      +'<td class="muted">'+esc(when)+'</td>'
      +'<td>'+tgl+' <button class="xbtn" data-act="del" data-id="'+esc(id)+'">Hapus</button></td>'
      +'</tr>';
  }
  rows.innerHTML=html||'<tr><td colspan="6" class="muted">Tidak ada yang cocok dengan pencarian.</td></tr>';
}

function attachRowHandler(){
  document.getElementById("rows").addEventListener("click",function(e){
    var t=e.target.closest("[data-act]"); if(!t) return;
    var id=t.getAttribute("data-id"); var act=t.getAttribute("data-act");
    if(act==="toggle") toggleUser(id, t.getAttribute("data-to")==="1");
    else if(act==="del") delOne(id);
  });
}

async function toggleUser(id, active){
  await fetch("/api/admin/toggle",{method:"POST",headers:H(),body:JSON.stringify({productId:CUR,userId:id,active:active})});
  await loadDB();
}
async function delOne(id){
  if(!confirm("Hapus permanen whitelist ID "+id+" ?")) return;
  await fetch("/api/admin/revoke",{method:"POST",headers:H(),body:JSON.stringify({productId:CUR,userId:id,hard:true})});
  await loadDB();
}

// ---- validasi username/ID sebelum diberi whitelist ----
function resetTargetInput(){
  VALIDATED=null;
  document.getElementById("g_input").value="";
  document.getElementById("resolveBox").className="resolve-box empty";
  document.getElementById("resolveBox").innerHTML="Isi username/ID lalu klik Validasi untuk memastikan akunnya benar.";
  document.getElementById("grantBtn").disabled=true;
}
function onTargetInput(){
  VALIDATED=null;
  document.getElementById("grantBtn").disabled=true;
  var box=document.getElementById("resolveBox");
  box.className="resolve-box empty";
  box.innerHTML="Belum divalidasi. Klik tombol Validasi.";
}
async function validateTarget(){
  var input=document.getElementById("g_input").value.trim();
  var box=document.getElementById("resolveBox");
  if(!input){ box.className="resolve-box empty"; box.innerHTML="Isi username/ID lalu klik Validasi."; return; }
  box.className="resolve-box empty"; box.innerHTML="Memeriksa ke Roblox...";
  document.getElementById("grantBtn").disabled=true;
  try{
    var r=await fetch("/api/admin/resolve",{method:"POST",headers:H(),body:JSON.stringify({input:input})});
    var j=await r.json();
    if(j.found){
      VALIDATED=j;
      box.className="resolve-box good";
      box.innerHTML=(j.avatarUrl?'<img class="av" src="'+esc(j.avatarUrl)+'">':'<div class="av ph"></div>')
        +'<div><b>'+esc(j.username)+'</b><br><span class="muted">'+esc(j.userId)+'</span></div>';
      document.getElementById("grantBtn").disabled=false;
    } else {
      VALIDATED=null;
      box.className="resolve-box bad";
      box.innerHTML="Username/ID tidak ditemukan di Roblox.";
    }
  } catch(e){
    box.className="resolve-box bad"; box.innerHTML="Gagal memeriksa. Coba lagi.";
  }
}

function selectedIds(){ var out=[]; var xs=document.querySelectorAll(".sel:checked"); for(var i=0;i<xs.length;i++) out.push(xs[i].value); return out; }

async function grant(){
  if(!VALIDATED){ document.getElementById("grantMsg").textContent=" Validasi dulu username/ID-nya."; return; }
  var body={productId:CUR,userId:VALIDATED.userId,username:VALIDATED.username,note:document.getElementById("g_note").value};
  var r=await fetch("/api/admin/grant",{method:"POST",headers:H(),body:JSON.stringify(body)});
  var j=await r.json();
  document.getElementById("grantMsg").textContent=j.ok?(" Berhasil"+(j.username?(" ("+j.username+")"):"")+(j.isNew?" - dikirim ke Discord bila webhook aktif.":"")):(" Gagal: "+(j.error||""));
  document.getElementById("g_note").value="";
  resetTargetInput();
  await loadDB();
}

async function deleteSelected(){
  var ids=selectedIds(); if(ids.length===0){ document.getElementById("listMsg").textContent=" Pilih dulu barisnya."; return; }
  if(!confirm("Hapus permanen "+ids.length+" whitelist?")) return;
  for(var i=0;i<ids.length;i++){ await fetch("/api/admin/revoke",{method:"POST",headers:H(),body:JSON.stringify({productId:CUR,userId:ids[i],hard:true})}); }
  document.getElementById("listMsg").textContent=" Terhapus.";
  await loadDB();
}

async function deleteProduct(){
  var p=products()[CUR]; if(!p) return;
  if(!confirm('Hapus produk "'+(p.name||CUR)+'" beserta SEMUA whitelistnya?')) return;
  if(!confirm('Konfirmasi sekali lagi. Tindakan ini permanen dan tidak bisa dibatalkan. Lanjut hapus?')) return;
  var r=await fetch("/api/admin/product/delete",{method:"POST",headers:H(),body:JSON.stringify({productId:CUR})});
  var j=await r.json();
  if(j.ok){ CUR=""; await loadDB(); } else { alert("Gagal: "+(j.error||"")); }
}

function buildSnippet(url,pid){
  var s=[
    'do',
    '  local HttpService = game:GetService("HttpService")',
    '  local Players     = game:GetService("Players")',
    '  local RunService  = game:GetService("RunService")',
    '  local PRODUCT_ID  = "'+pid+'"',
    '  local LICENSE_URL = "'+url+'"',
    '  local KICK_MSG    = "Sistem ini tidak berlisensi untuk game ini."',
    '  local function check()',
    '    local nonce = HttpService:GenerateGUID(false)',
    '    local ok, res = pcall(function()',
    '      return HttpService:PostAsync(LICENSE_URL, HttpService:JSONEncode({',
    '        productId = PRODUCT_ID, creatorId = game.CreatorId,',
    '        creatorType = game.CreatorType.Name, placeId = game.PlaceId, nonce = nonce,',
    '      }), Enum.HttpContentType.ApplicationJson)',
    '    end)',
    '    if not ok then return nil end',
    '    local ok2, data = pcall(function() return HttpService:JSONDecode(res) end)',
    '    if not ok2 or type(data) ~= "table" or data.nonce ~= nonce then return nil end',
    '    return data.authorized == true',
    '  end',
    '  local function definitive()',
    '    for _ = 1, 4 do',
    '      local r = check()',
    '      if r ~= nil then return r end',
    '      task.wait(3)',
    '    end',
    '    return nil',
    '  end',
    '  local function deniedTwice()',
    '    if definitive() ~= false then return false end',
    '    task.wait(6)',
    '    return definitive() == false',
    '  end',
    '  local kicked = false',
    '  local function shutdown(reason)',
    '    if kicked then return end',
    '    kicked = true',
    '    warn("[Lisensi] " .. tostring(reason) .. " - sistem dimatikan.")',
    '    Players.PlayerAdded:Connect(function(p) pcall(function() p:Kick(KICK_MSG) end) end)',
    '    for _, p in ipairs(Players:GetPlayers()) do pcall(function() p:Kick(KICK_MSG) end) end',
    '  end',
    '  if deniedTwice() then',
    '    shutdown("Tidak ter-whitelist")',
    '    return',
    '  end',
    '  task.spawn(function()',
    '    while not kicked do',
    '      task.wait(300)',
    '      if deniedTwice() then',
    '        shutdown("Whitelist dicabut")',
    '        break',
    '      end',
    '    end',
    '  end)',
    'end',
    '-- ================================================'
  ];
  return s.join(NL);
}

function copySnippet(){
  var url=location.origin+"/api/verify";
  var code=buildSnippet(url,CUR);
  copyText(code, null, "Snippet disalin. Tempel di paling atas Script-mu.");
}

function copyText(text, btn, msg){
  function done(){ if(btn){ var old=btn.textContent; btn.textContent="Tersalin"; setTimeout(function(){btn.textContent=old;},1200); } if(msg){ document.getElementById("listMsg").textContent=" "+msg; } }
  if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(done, function(){ fallbackCopy(text); done(); }); }
  else { fallbackCopy(text); done(); }
}
function fallbackCopy(text){
  var ta=document.createElement("textarea"); ta.value=text; ta.style.position="fixed"; ta.style.opacity="0";
  document.body.appendChild(ta); ta.focus(); ta.select();
  try{ document.execCommand("copy"); }catch(e){}
  document.body.removeChild(ta);
}
</script>
</body></html>`;
