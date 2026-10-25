# Lentera

Notch kecil yang "hidup" di tengah atas layar Windows, mirip Dynamic Island.
Arahkan kursor ke notch untuk membuka panel lengkap.

## Fitur

Tampilannya mengikuti Nusa: notch hitam dengan cincin baterai, jam, dan
gelombang suara; panel terbuka dengan panah kiri/kanan dan titik halaman
(bisa juga digulir dengan roda mouse); kartu sekilas dengan cincin progres.
Fitur tambahan ditandai ✨. Semua teks di aplikasi berbahasa Inggris.

Saat tidak dipakai, notch mengecil jadi garis hitam tipis. Ukuran notch dikunci di 60% dengan
huruf yang diperbesar. Gayanya kaca buram (frosted, latar di belakang notch ikut diburamkan oleh
Windows) dengan sentuhan komik pixel: huruf Pixelify Sans, garis tinta goresan tangan, titik raster.
Settings dibuka lewat ikon gerigi di kiri atas panel.

| Fitur | Keterangan |
| --- | --- |
| 🕒 Notch tertutup | Menampilkan jam. Saat komputer diam ±45 detik, jam memudar dan muncul sepasang mata yang lama-lama tertidur, lalu "melambai" saat kamu kembali. Ada mode **notch minimal** (garis tipis). |
| 🎵 Musik | Lagu dari pemutar apa saja (Spotify, YouTube di browser, dll.), waktu berjalan dan sisa waktu, bar yang bisa diklik untuk menggeser lagu, tombol putar/jeda/maju/mundur. |
| ❝ Lirik | Tombol lirik membelah notch jadi dua panel. Baris yang sedang dinyanyikan menyala; klik baris untuk loncat ke bagian itu. Lirik dari [LRCLIB](https://lrclib.net). |
| ⏱️ Fokus ✨ | Timer dengan durasi bebas (jam/menit/detik), bisa diberi nama, disimpan sebagai preset, dan diulang otomatis. Plus **stopwatch** yang terus berjalan walau notch ditutup atau aplikasi dibuka ulang. |
| 🕌 Sholat 5 waktu ✨ | Jadwal online dari data resmi Kemenag RI (lewat api.myquran.com), diperbarui otomatis tiap 6 jam; bisa cari kabupaten/kota mana pun di Indonesia. Kuala Lumpur/Singapura/koordinat sendiri memakai api.aladhan.com. Tanpa internet, dihitung offline (metode Kemenag). Tiap waktu punya warna sendiri: Subuh ungu fajar, Dzuhur kuning, Ashar jingga, Maghrib merah senja, Isya biru malam berbintang. Pengingat sebelum dan saat masuk waktu. |
| 💧 Air | Target 1,5–3 L, saklar pengingat, ukuran botol/gelas, jam pengingat, dan grafik minum 9 jam terakhir. |
| 🗂️ Rak | Seret file/folder ke notch, lalu seret keluar lagi. Menampilkan ukuran file. Klik untuk membuka, klik kanan untuk membuka foldernya. |
| ✅ To-do | Hitungan "selesai hari ini", tambah/ubah tugas, tugas bisa diberi jam dan notch akan mengingatkan. |
| 🔋🎧📶 Kartu sekilas | Muncul sebentar saat charger dicolok, earbuds tersambung, Wi-Fi putus, baterai lemah. |
| 🔊⇪⌨ Tampilan kecil | Volume, Caps Lock, dan ganti bahasa keyboard (dibaca berkala, tanpa merekam ketikan). |
| 🔔 Notifikasi ✨ | Notifikasi aplikasi lain tampil sekilas di notch dan tersimpan di tab Notif. |
| 🕷️ Spidey ✨ | Spider-Man kecil bergaya pixel art yang turun bergelantungan di benang jaring di samping notch tiap beberapa menit: menyapa, minum, joget saat ada lagu, mengantuk saat malam, mengingatkan sholat, kaget saat baterai lemah. Bisa diklik. |

Urutan halaman: Musik, Timer, Sholat, Air, Rak, Tugas, Notifikasi, Pengaturan.
Pengaturan ada di halaman terakhir dan di ikon tray dekat jam Windows.

## Membuat file .exe (installer)

Aplikasi ini dibuat dengan [Tauri 2](https://tauri.app) (Rust + tampilan HTML/CSS/JS).

### Cara 1: lewat GitHub (tanpa memasang apa pun)

1. Buat repo GitHub baru dan unggah isi folder ini.
2. GitHub Actions otomatis menjalankan `.github/workflows/build.yml`.
3. Setelah selesai (±10 menit), buka tab **Actions** → run terbaru → unduh
   **Lentera-installer**. Di dalamnya ada `Lentera_1.0.0_x64-setup.exe`.

### Cara 2: di komputer Windows sendiri

1. Pasang [Rust](https://rustup.rs). Saat diminta, pasang juga
   "Visual Studio Build Tools" dengan pilihan *Desktop development with C++*.
2. Buka PowerShell di folder ini, lalu:

   ```powershell
   cargo install tauri-cli --version "^2" --locked
   cargo tauri build
   ```

3. Installer ada di `src-tauri\target\release\bundle\nsis\`.

Untuk mencoba sambil mengubah kode: `cargo tauri dev`.

Mau lihat tampilannya tanpa build? Jalankan server statis di folder `src`
(misalnya `python -m http.server`) lalu buka di browser. Data yang tampil
adalah data contoh.

## Struktur

```
src/                 Tampilan (HTML, CSS, JS)
  js/app.js          Logika utama semua fitur
  js/prayer.js       Perhitungan jadwal sholat + daftar kota
  js/mascot.js       Karakter Tera dan kalimat-kalimatnya
  js/bridge.js       Penghubung ke Rust (dan data contoh untuk browser)
src-tauri/           Bagian Rust
  src/lib.rs         Jendela, tray, klik tembus, perintah
  src/system.rs      Musik, baterai, internet, Bluetooth, notifikasi (API Windows)
  src/lyrics.rs      Ambil lirik dari LRCLIB
```

## Catatan

- **Notifikasi aplikasi lain**: Windows hanya mengizinkan fitur ini untuk
  sebagian aplikasi. Kalau di tab 🔔 muncul pesan belum diizinkan, fitur lain
  tetap jalan normal.
- **Jadwal sholat** bisa selisih 1–3 menit dari jadwal masjid setempat. Atur
  di ⚙️ → *Koreksi jadwal (menit)*. Jadwal mengikuti zona waktu komputer.
- Data (to-do, rak, air, timer, pengaturan) disimpan di komputer sendiri.
  File di rak tidak disalin, hanya alamatnya yang diingat.
