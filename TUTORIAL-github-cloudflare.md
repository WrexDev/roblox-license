# Tutorial — GitHub + Cloudflare Workers (Auto-Deploy)

Kode server di GitHub. Cloudflare otomatis deploy tiap kamu push. Gratis, tanpa
kartu kredit. Data whitelist permanen di KV. Semua lewat browser (tanpa install
apa pun). Termasuk panel admin, log ke Discord dengan identitas bot yang bisa
kamu custom, dan (opsional) bot interaktif dengan command `/own` untuk anggota
Discord-mu.

Isi repo (folder `github-repo/`): `worker.js`, `wrangler.toml`, `package.json`,
`.gitignore`.

Estimasi: 25–35 menit pertama kali.

---

## BAGIAN 1 — Taruh kode di GitHub

1. Login GitHub → tombol **+** kanan atas → **New repository**.
2. Name: `roblox-license`. Pilih **Private**. **Create repository**.
3. Di halaman kosong, klik **uploading an existing file**.
4. Seret **semua isi folder `github-repo/`**:
   `worker.js`, `wrangler.toml`, `package.json`, `.gitignore`.
5. **Commit changes**.

---

## BAGIAN 2 — Buat penyimpanan KV & catat ID-nya

1. Login https://dash.cloudflare.com (daftar dulu bila belum — cukup email,
   tanpa kartu).
2. Menu kiri **Workers & Pages** → tab **KV** → **Create a namespace**.
3. Nama: `LICENSE` → **Add**.
4. Setelah jadi, **salin Namespace ID**-nya (deretan huruf/angka).

### Tempel ID ke wrangler.toml
5. Kembali ke repo GitHub → buka file `wrangler.toml` → klik ikon pensil (Edit).
6. Ganti ID di baris `id = "..."` dengan ID yang tadi kamu salin.
7. **Commit changes**.

Contoh hasilnya:
```
[[kv_namespaces]]
binding = "LICENSE_KV"
id = "a1b2c3d4e5f6....."
```

---

## BAGIAN 3 — Hubungkan GitHub ke Cloudflare (auto-deploy)

1. Cloudflare → **Workers & Pages** → **Create** → pilih **Import a repository**
   (atau tab **Connect to Git**).
2. Klik **Connect GitHub** → izinkan (authorize) → pilih repo `roblox-license`.
3. Cloudflare membaca `wrangler.toml`. Pastikan:
   - **Project/Worker name** = `roblox-license` (harus sama dengan di wrangler.toml).
   - **Deploy command**: `npx wrangler deploy` (biasanya sudah otomatis).
4. Klik **Create / Deploy**. Tunggu build selesai (1–2 menit).

URL Worker-mu muncul, mis. `https://roblox-license.namamu.workers.dev`
— **catat URL ini.**

> Mulai sekarang, setiap kali kamu edit file di GitHub dan Commit, Cloudflare
> otomatis deploy ulang.

---

## BAGIAN 4 — Pasang kunci admin (secret)

1. Cloudflare → Worker `roblox-license` → **Settings** →
   **Variables and Secrets** → **Add**.
2. **Type: Secret** (terenkripsi). **Name**: `ADMIN_KEY`.
   **Value**: kata sandi panjang rahasiamu (mis. `k7f9-rahasia-panjang`).
3. **Save / Deploy**.

> Pakai tipe **Secret**, bukan plaintext var — supaya tidak tertimpa saat
> deploy berikutnya, dan tidak terlihat di dashboard.

Cek: buka `https://roblox-license.namamu.workers.dev/` → "License server aktif".
Buka `.../admin` → panel muncul.

---

## BAGIAN 5 — Buat produk & ambil snippet

Sekarang produk dibuat lewat panel (bukan lagi ditulis manual di kode).

1. Buka `https://roblox-license.namamu.workers.dev/admin`, masukkan **Kunci Admin**
   (= `ADMIN_KEY`).
2. Di bagian **Buat produk baru**, isi nama (mis. `Music System`) → **Buat produk**.
   - Sistem otomatis membuat **ID Produk acak** (huruf+angka), mis. `k7m2p9qx4a1b`.
   - Tercatat juga tanggal dibuat.
3. Klik produk itu di daftar kiri untuk membukanya.
4. Klik **Salin snippet**. Snippet Lua sudah otomatis berisi **ID Produk** dan
   **URL Worker**-mu — tanpa perlu edit apa pun.

### Pasang di Roblox
5. Roblox Studio: **Game Settings → Security → Allow HTTP Requests = ON**.
6. Tempel snippet tadi di **paling atas** tiap Script yang kamu jual.

> Snippet dibuat bersih tanpa komentar supaya pendek, kecuali satu baris
> penanda `-- ================================================` di paling
> akhir (menandai batas akhir kode proteksi). Kalau butuh menyalin ID
> produk saja, ada tombol **Salin ID**.

---

## BAGIAN 6 — Whitelist pembeli (di dalam produk)

- User ID = angka di URL profil pembeli:
  `https://www.roblox.com/users/123456789/profile` → `123456789`.
- Buka produk yang sesuai di panel → bagian **Tambah whitelist** → isi
  **username ATAU User ID** pembeli → klik **Validasi**.
- Panel akan mengecek ke Roblox dan menampilkan avatar + username kalau
  ditemukan. Tombol **Beri whitelist** baru aktif setelah validasi berhasil,
  supaya tidak salah memberi akses ke akun yang salah.
- Daftar whitelist tampil di bawahnya, lengkap dengan avatar & username.

Di dalam tiap produk kamu bisa:
- **Cari produk** (kolom pencarian di atas daftar produk).
- **Cari username/ID** (kolom pencarian di atas daftar whitelist).
- **Aktifkan / Nonaktifkan** tiap ID lewat tombol di barisnya. Kalau statusnya
  nonaktif, tombolnya jadi **Aktifkan**; kalau aktif, jadi **Nonaktifkan**.
- **Hapus** satu ID, atau centang beberapa lalu **Hapus yang dipilih**.
- **Hapus produk** (butuh 2x konfirmasi karena permanen).

Mencabut whitelist / menonaktifkan → game akan shutdown paksa dalam ~5 menit.

---

## BAGIAN 7 — (Opsional) Log ke Discord

Supaya aktivitas whitelist transparan untuk anggota Discord-mu:

1. Discord → channel yang diinginkan → **Edit Channel → Integrations →
   Webhooks → New Webhook → Copy Webhook URL**.
2. Buka panel → menu **Pengaturan Discord** (di sidebar kiri).
3. Isi **Nama bot** dan (opsional) **URL ikon bot** — ini yang akan tampil
   sebagai nama & avatar pengirim log di Discord.
4. Tempel **Webhook URL** → **Simpan pengaturan**.

Mulai sekarang, **setiap ID baru** yang kamu whitelist otomatis terkirim ke
channel itu: nama produk (diawali simbol ➤), username, User ID, link profil,
dan waktu. ID produk dan catatan **tidak** ditampilkan di Discord — catatan
tetap tersimpan di panel untuk arsip internalmu saja. Kalau kolom webhook
dikosongkan, fitur ini mati.

---

## BAGIAN 8 — (Opsional) Bot interaktif: command `/own`

Anggota Discord-mu bisa ketik `/own <username_atau_id_roblox>` (mis.
`/own paksatpam_9` atau `/own 2211233412`) untuk melihat sendiri produk apa
yang lisensinya mereka miliki. Bot akan **membalas langsung di bawah
command** yang mereka ketik supaya tidak membingungkan.

Ini butuh Discord **Application + Bot** (bukan sekadar webhook), karena
command interaktif perlu endpoint yang bisa diverifikasi Discord:

1. Buka https://discord.com/developers/applications → **New Application**.
2. Tab **Bot** → **Add Bot** → **Reset Token** → salin token-nya
   (ini `DISCORD_BOT_TOKEN`).
3. Tab **General Information** → salin **Application ID**
   (ini `DISCORD_APPLICATION_ID`) dan **Public Key**
   (ini `DISCORD_PUBLIC_KEY`).
4. Tab **OAuth2 → URL Generator** → centang scope `bot` dan
   `applications.commands` → buka URL yang dihasilkan untuk mengundang bot
   ke server Discord-mu.
5. Cloudflare → Worker `roblox-license` → **Settings → Variables and
   Secrets** → tambahkan 3 secret di atas (tipe **Secret**, sama seperti
   `ADMIN_KEY`).
6. Kembali ke **General Information** aplikasi Discord-mu → isi
   **Interactions Endpoint URL** dengan URL yang tertulis di panel
   (menu **Pengaturan Discord**, biasanya
   `https://roblox-license.namamu.workers.dev/discord/interactions`) →
   **Save Changes**. Discord akan langsung mengetes endpoint ini; kalau
   gagal, cek ulang ketiga secret di langkah 5.
7. Buka panel → **Pengaturan Discord** → pastikan status secret tertulis
   "Secret bot sudah lengkap" → klik **Daftarkan command /own**.
8. Selesai. Coba ketik `/own` di server Discord-mu.

> Fitur ini terpisah dari webhook log di Bagian 7 — kamu boleh pakai salah
> satu saja atau keduanya.

---

## BAGIAN 9 — Uji

1. Whitelist User ID-mu → publish & jalankan game → normal.
2. Cabut/nonaktifkan → tunggu/restart server game → kamu ter-kick. Berhasil.
3. Whitelist lagi.

> **Catatan penting:** sekarang **Roblox Studio pun ikut di-shutdown** kalau
> ID tidak ter-whitelist. Jadi tes di Studio dengan akun yang belum di-whitelist
> akan ditolak, sama seperti server live.

---

## Mengubah kode nanti
Edit file di GitHub → Commit → Cloudflare deploy otomatis. Data whitelist &
produk di KV tidak terpengaruh oleh deploy, jadi daftar pembelimu aman.

## Masalah umum
- **Build gagal / nama tidak cocok:** nama Worker di dashboard harus sama dengan
  `name` di `wrangler.toml` (`roblox-license`).
- **Error 1101 / KV:** ID KV di `wrangler.toml` salah/kosong, atau binding bukan
  `LICENSE_KV`. Perbaiki, commit ulang.
- **Panel unauthorized:** Kunci Admin ≠ `ADMIN_KEY`. Samakan.
- **Selalu ter-kick:** Allow HTTP Requests ON? Snippet berisi ID produk & URL
  yang benar (pakai tombol Salin snippet)? ID pembeli sudah di-whitelist & aktif?
- **Log Discord tidak muncul:** webhook hanya dikirim untuk **ID baru**; grant
  ulang ke ID yang sudah ada tidak mengirim log. Pastikan Webhook URL benar.
- **Tombol "Beri whitelist" tidak bisa diklik:** klik dulu **Validasi** dan
  tunggu sampai username/avatar muncul. Kalau muncul "tidak ditemukan",
  periksa ejaan username/ID-nya.
- **`/own` tidak muncul di Discord / Interactions Endpoint gagal disimpan:**
  pastikan ketiga secret (`DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`,
  `DISCORD_APPLICATION_ID`) sudah tersimpan di Cloudflare **sebelum** kamu
  isi Interactions Endpoint URL di Discord, lalu klik **Daftarkan command
  /own** di panel.
