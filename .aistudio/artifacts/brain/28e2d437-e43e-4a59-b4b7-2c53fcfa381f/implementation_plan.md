# Desain Ulang Antarmuka Mobile Matcha & Olive — SiagaWarga RW 013

Transformasi menyeluruh tampilan visual **SiagaWarga RW 013** ke dalam bingkai aplikasi ponsel interaktif di tengah layar yang mengadopsi estetika hijau matcha, latar sage lembut bergantian putih bersih, kartu media kotak, pemilih ikon bulat, dan tombol aksi olive tua sesuai gambar referensi, sambil mempertahankan seluruh fungsi pelaporan real-time, GPS otomatis, notifikasi push, Kampung Bebas Jentik (ABJ), Mode 10 RT, analitik kerawanan, dashboard admin, serta gateway API instansi.

## User Review & Critical Decisions

> [!IMPORTANT]
> Rencana ini mengunci tiga keputusan desain utama yang telah Anda konfirmasi agar pengalaman visual selaras penuh dengan gambar referensi tanpa mengurangi fitur fungsional yang sudah terkoneksi ke Firebase.

- **Keputusan Terkonfirmasi 1 — Tata Letak Bingkai Ponsel Terpusat**: Aplikasi ditampilkan dalam bingkai layar ponsel proporsional (`420px × min-h-[840px]`, sudut membulat halus) tepat di tengah kanvas desktop (dan otomatis memenuhi layar secara penuh ketika dibuka langsung melalui ponsel warga), lengkap dengan bilah status atas, area gulir halus di tengah, serta navigasi tab bawah yang ramah jangkauan ibu jari.
- **Keputusan Terkonfirmasi 2 — Palet Matcha, Sage Lembut, Putih Bersih & Olive Tua**: Seluruh layar menggunakan pergantian permukaan **Sage Lembut (`#DCECC3`)** dan **Putih Hangat Bersih (`#F7F9F4` / `#FFFFFF`)**, berpadu dengan layar pembuka **Matcha Cerah (`#A5CF4C`)** serta tombol, thumbnail kotak, dan ikon aksi **Olive Tua (`#586826`)**.
- **Keputusan Terkonfirmasi 3 — Motif Layar Sambutan, Kartu Kotak & Layar Konfirmasi**: Menghadirkan alur layar pembuka matcha ke layar masuk Google, karusel kartu kotak dengan indikator titik, pemilih kategori bulat, grid katalog 3 kolom untuk 10 RT (`RT 001` – `RT 010`), bingkai foto kotak `1:1` saat melapor, hingga layar konfirmasi jempol/centang bulat setelah laporan berhasil dikirim.
- **Opsi Fleksibilitas Ruang Kerja Tabel Lebar (Default Direkomendasikan)**: Di luar bingkai ponsel pada layar desktop, disediakan tombol pengalih ukuran bingkai opsional (*Mode Ponsel Standar* / *Mode Layar Lebar Petugas*) di sudut luar kanvas sehingga petugas admin tetap nyaman saat meninjau matriks silang 10 RT atau tabel pengiriman API instansi.

---

## 1. Overview & Core Concept

- **What It Does**: Menyajikan seluruh ekosistem pelaporan warga RW 013 dan surveilans Kampung Bebas Jentik dalam pengalaman aplikasi mobile modern yang hangat, organik, dan taktil sesuai referensi visual. Warga dapat memotret kejadian sekitar secara langsung, mengunci titik GPS otomatis, memantau pembaruan status via notifikasi push, memeriksa rekap per RT (`RT 001` – `RT 010`), hingga mengelola triase admin dan integrasi API instansi dari satu cangkang aplikasi ponsel yang konsisten.
- **Target Audience / Persona**:
  - **Warga RW 013 (`RT 001` – `RT 010`)**: Mengirimkan bukti foto kejadian dan memantau tindak lanjut dengan satu tangan.
  - **Kader Jumantik**: Mencatat pemeriksaan jentik mingguan dan memantau capaian Angka Bebas Jentik (ABJ $\ge 95\%$).
  - **Pengurus RW & Petugas Admin**: Melakukan verifikasi laporan, mengirim notifikasi push pembaruan status, memantau peta zona rawan, dan meneruskan laporan ke API dinas terkait.
- **Key Value**: Mengubah tampilan dashboard teknis menjadi antarmuka mobile komunal yang akrab, kontras tinggi di bawah sinar matahari luar ruang, memiliki alur langkah demi langkah yang jelas, dan memberikan kepastian visual seketika saat laporan terkirim.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Alur Sambutan Matcha & Masuk Akun (Referensi Layar 1 & 2)**:
   - Saat belum masuk, pengguna disambut **Layar Pembuka Matcha (`#A5CF4C`)** dengan ikon lambang lingkungan RW 013 berwarna Olive Tua di tengah, judul aplikasi, slogan singkat, serta dua tombol penuh membulat berwarna Olive Tua di bagian bawah (*Masuk Aplikasi* dan *Pedoman ABJ RW 013*).
   - Menekan *Masuk Aplikasi* menggeser layar secara mulus ke **Layar Masuk Putih Bersih (`#F7F9F4`)** bergaya minimalis dengan ringkasan akses aman warga/petugas dan tombol utama *Masuk dengan Akun Google*.
2. **Alur Beranda, Karusel Kotak & Daftar Laporan (Referensi Layar 3, 4 & 5)**:
   - Bagian atas menampilkan bilah aplikasi ringkas (profil RT domisili di kiri, judul layar di tengah, lonceng notifikasi push di kanan).
   - Di bawahnya terdapat **Karusel Sorotan Kotak** (`rounded-2xl` dengan indikator titik `• ◦ ◦ ◦`) yang merangkum Peta Geografis Aktif RW 013, Capaian ABJ Bebas Jentik, Ringkasan 10 RT, dan Status Penanganan.
   - Baris **6 Ikon Bulat Olive (`44×44px`)** berfungsi sebagai pemilih cepat kategori layanan (*Jentik/DBD*, *Drainase*, *Jalan*, *Sampah*, *Keamanan*, *PJU*).
   - Daftar laporan terbaru dirender sebagai **Kartu Horizontal Taktil** (kotak foto/ikon olive `64×64px` di kiri, judul dan metadata bersih bertanda pemisah `·` di tengah, serta status tindak lanjut di kanan).
3. **Alur Mode Katalog 10 RT & Surveilans Jumantik (Referensi Layar 6, 7 & 10)**:
   - Menampilkan bilah tab filter horizontal di atas diikuti **Grid Katalog 3 Kolom Kartu Kotak** untuk kesepuluh wilayah (`RT 001` sampai `RT 010`), masing-masing memiliki kotak ikon olive, kode RT, jumlah laporan aktif, dan angka ABJ.
   - Mengetuk salah satu kartu RT membuka ruang detail RT tersebut (peta titik kejadian RT, daftar laporan khusus RT, tombol unduh CSV, dan tombol cepat *Lapor untuk RT Ini* di bagian bawah).
4. **Alur Kirim Laporan Foto Kotak & Layar Konfirmasi Sukses (Referensi Layar 11 & 12)**:
   - Layar pelaporan berlatar **Sage Lembut (`#DCECC3`)** menampilkan identitas pelapor & RT di atas, **Bingkai Kamera/Foto Kotak Besar (`1:1`)** berwarna Olive Tua di tengah untuk tangkapan kamera WebRTC langsung atau unggah foto, kartu pengunci koordinat GPS & alamat otomatis, kolom judul/deskripsi, serta tombol kirim Olive Tua di bawah.
   - Begitu laporan tersimpan ke Firestore, tampilan beralih ke **Layar Konfirmasi Sukses** berlatar putih bersih dengan lingkaran lencana jempol/centang Olive Tua besar di tengah, ringkasan nomor & lokasi laporan, pratinjau tahapan tindak lanjut 3 kotak di bawahnya, serta tombol kembali ke Beranda atau lihat detail laporan.
5. **Alur Analitik Kerawanan, Admin & API Instansi (Referensi Layar 8 & 9)**:
   - Memakai tajuk tekstur organik gelap dengan **Kartu Ringkasan Olive Tua Tumpang-Tindih** berisi bar progres hijau matcha untuk tren 14 hari, jam rawan kejadian, triase pembaruan status laporan oleh admin (otomatis memicu notifikasi push), serta pengiriman webhook HMAC-SHA256 ke instansi terkait.

### Visual Identity & Theme

- **Aesthetic Direction**: *Organic Botanical Mobile Kit* — bersih, membumi, ramah sentuhan, dengan kontras hijau zaitun tua di atas kanvas teh hijau/putih hangat tanpa dekorasi berlebihan.
- **Color Palette & Mood (CSS Theme Tokens)**:
  - `--bg-studio-outer`: `#E2E8DA` (Latar belakang studio lembut di luar bingkai ponsel pada layar desktop).
  - `--bg-canvas-white`: `#F7F9F4` (Kanvas layar utama putih hangat bersih — pergantian layar ganjil/genap).
  - `--bg-canvas-sage`: `#DCECC3` (Kanvas layar hijau sage lembut untuk layar pelaporan, daftar RT, dan detail surveilans).
  - `--bg-splash-matcha`: `#A5CF4C` (Permukaan sambutan hijau matcha cerah & aksen bar progres aktif).
  - `--surface-card`: `#FFFFFF` dan `#E7F3D4` (Permukaan kartu konten dengan batas tipis `#CAD9B5`).
  - `--primary-olive`: `#586826` / hover `#48561E` (Warna aksi utama tombol membulat penuh, kotak ikon media, dan indikator tab aktif dengan teks terang `#F9FBF6` berkontras WCAG AA > 6.2:1).
  - `--text-ink`: `#263015` (Teks utama hijau-arang gelap) dan `--text-muted`: `#5B6649` (Teks sekunder).
  - `--status-semantic`: Dipasangkan selalu dengan teks eksplisit dan ikon (`Menunggu`, `Diverifikasi`, `Diproses`, `Selesai`, `Darurat`) agar tidak bergantung pada warna semata.
- **Typography & Hierarchy**:
  - **Judul & Antarmuka**: `Plus Jakarta Sans` (SemiBold/Bold `600–700` untuk judul layar `18px–24px` dengan `text-wrap: balance`; Regular/Medium `400–500` `14px–15px` untuk isi kartu).
  - **Angka, Koordinat GPS, persentase ABJ & Kode RT**: `JetBrains Mono` dengan `tabular-nums` (`11px–13px`) agar seluruh metrik sejajar presisi.
- **Component Styling & Ergonomic Rules**:
  - **Target Sentuh Minimum**: Setiap tombol, ikon bulat kategori, kartu RT, dan tab navigasi bawah memiliki area klik minimal `44×44px` (`h-11` hingga `h-12` untuk tombol utama).
  - **Batas Permukaan Lengket 15%**: Tinggi gabungan bilah atas (`52px`) dan navigasi tab bawah (`60px`) dijaga ramping agar lebih dari 85% ruang vertikal bingkai ponsel tetap lega untuk konten dan peta.
  - **Disiplin Metadata Tanpa Pill**: Kategori, kode RT, urgensi, dan waktu tampil sebagai teks inline rapi dengan pemisah titik tengah (`Kesehatan / Jentik · RT 004 · 10 mnt lalu`), sedangkan tombol filter menggunakan kontrol segmen interaktif berlatar sage/olive.

### Interactive Feedback & Motion

- Transisi antar-tab dan layar sambutan ke layar masuk menggunakan animasi `opacity` dan `transform` ringan ($\le 180\text{ms}$, `cubic-bezier(0.16, 1, 0.3, 1)`).
- Umpan balik tekan taktil (`active:scale-[0.98]`) pada seluruh tombol Olive Tua, ikon bulat kategori, dan kartu grid 10 RT.
- Banner notifikasi push melayang di bagian atas dalam bingkai ponsel ketika petugas memperbarui status laporan secara real-time, dilengkapi laci geser bawah (*bottom sheet* bersudut `rounded-t-3xl`) untuk kotak masuk notifikasi dan modal detail laporan.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Cangkang Bingkai Ponsel Terpusat dengan Opsi Perluasan Kerja**
  - *Chosen Approach*: Merender aplikasi di dalam bingkai ponsel terpusat (`max-w-[420px]`) di tengah layar desktop lengkap dengan bilah navigasi bawah 5 tab utama + menu laci modul lanjutan, ditambah tombol kecil di luar bingkai untuk memperlebar tampilan bila admin sedang memeriksa matriks besar.
  - *Why*: Memenuhi pilihan langsung pengguna agar identik dengan tampilan kartu ponsel pada gambar referensi, sembari memastikan peta Leaflet, tabel rekap ABJ, dan dashboard admin tetap ergonomis dioperasikan.
  - *Alternatives Considered*: Tata letak sidebar desktop penuh dilewati sebagai tampilan bawaan karena tidak merepresentasikan proporsi kartu aplikasi mobile pada referensi.

- **Decision 2: Adaptasi Motif Visual Referensi ke Domain Pelaporan Warga & Jumantik**
  - *Chosen Approach*: Memetakan setiap pola visual dari 12 layar referensi (splash matcha, sign-in bersih, karusel kotak, daftar ber-thumbnail kotak olive, deretan ikon bulat, grid katalog 3 kolom, unggah foto kotak `1:1`, dan layar sukses jempol bulat) langsung ke alur nyata SiagaWarga RW 013.
  - *Why*: Menghadirkan kemiripan estetika yang kuat dengan gambar referensi tanpa memunculkan teks placeholder atau mengurangi fungsi pelaporan warga, 10 RT, maupun ABJ RW 013.
  - *Alternatives Considered*: Sekadar mengganti warna latar dan tombol pada tabel lama ditolak karena tidak menghadirkan karakter kartu kotak, pemilih bulat, dan layar konfirmasi khas referensi.

- **Decision 3: Pelestarian Penuh Keamanan Firestore & Endpoint API Instansi**
  - *Chosen Approach*: Mempertahankan seluruh skema koleksi Firestore, aturan keamanan terverifikasi, kompresi foto sisi klien, reverse-geocoding server, dan endpoint REST/GeoJSON tanpa perubahan struktur data yang merusak kompatibilitas.
  - *Why*: Menjamin seluruh data laporan warga, catatan Jumantik 10 RT, notifikasi push, dan riwayat pengiriman API yang sudah tersimpan di database Firebase pengguna tetap berjalan mulus secara real-time.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```text
┌────────────────────────────────────────────────────────────────────────────┐
│                   KANVAS STUDIO DESKTOP (#E2E8DA)                          │
│         ┌────────────────────────────────────────────────────────┐         │
│         │        BINGKAI APLIKASI PONSEL TERPUSAT (420px)        │         │
│         │  ┌──────────────────────────────────────────────────┐  │         │
│         │  │ Alur Pra-Masuk (Belum Autentikasi)               │  │         │
│         │  │ [Layar Sambutan Matcha] ──▶ [Layar Masuk Google] │  │         │
│         │  └────────────────────────┬─────────────────────────┘  │         │
│         │                           ▼                            │         │
│         │  ┌──────────────────────────────────────────────────┐  │         │
│         │  │ Bilah Atas Ringkas (Domisili RT · Judul · Notif) │  │         │
│         │  ├──────────────────────────────────────────────────┤  │         │
│         │  │ Ruang Layar Bergantian (Putih Bersih / Sage)     │  │         │
│         │  │  ├─ 1. Beranda: Karusel Kotak + 6 Ikon Bulat     │  │         │
│         │  │  │     + Peta Leaflet + Kartu Laporan Horizontal │  │         │
│         │  │  ├─ 2. Mode 10 RT: Grid 3 Kolom Kotak (RT 01-10) │  │         │
│         │  │  │     + Ruang Detail RT & Ekspor CSV            │  │         │
│         │  │  ├─ 3. Lapor Foto: Kanvas Sage + Foto Kotak 1:1  │  │         │
│         │  │  │     + Kunci GPS ──▶ [Layar Konfirmasi Jempol] │  │         │
│         │  │  ├─ 4. Bebas Jentik: Rekap ABJ & Form Jumantik   │  │         │
│         │  │  └─ 5. Lainnya: Analitik Rawan, Admin & API      │  │         │
│         │  ├──────────────────────────────────────────────────┤  │         │
│         │  │ Bottom Sheets: Kotak Masuk Push & Detail Laporan │  │         │
│         │  ├──────────────────────────────────────────────────┤  │         │
│         │  │ Navigasi Tab Bawah Olive (Beranda·10 RT·+·ABJ·≡) │  │         │
│         │  └──────────────────────────────────────────────────┘  │         │
│         └───────────────────────────┬────────────────────────────┘         │
└─────────────────────────────────────┼──────────────────────────────────────┘
                                      │
          ┌───────────────────────────┴───────────────────────────┐
          ▼                                                       ▼
┌───────────────────────────────────┐   ┌────────────────────────────────────┐
│ Firebase Auth & Firestore Live DB │   │ Backend Express API Gateway (/api) │
│ • users & private PII subcollect  │   │ • /api/v1/geocode/reverse (GPS)    │
│ • reports (10 RT, foto, koordinat)│   │ • /api/v1/reports (JSON & GeoJSON) │
│ • jumantikLogs (ABJ RW 013)       │   │ • /api/v1/reports/by-rt            │
│ • notifications (real-time push)  │   │ • /api/v1/jumantik/summary         │
│ • agencyDispatches & admins RBAC  │   │ • /api/v1/webhooks/dispatch (HMAC) │
└───────────────────────────────────┘   └────────────────────────────────────┘
```

### Data Model & State

- **State Navigasi & Bingkai Antarmuka**:
  - `welcomeStep` (`'splash' | 'signin'`): Mengatur perpindahan antara Layar Sambutan Matcha dan Layar Masuk Putih Bersih sebelum pengguna masuk dengan Google.
  - `activeTab` (`'overview' | 'per_rt' | 'create_report' | 'jumantik' | 'analytics' | 'admin' | 'api_gateway'`): Mengatur layar aktif serta otomatis menyesuaikan warna kanvas latar (`Putih Bersih` vs `Sage Lembut`) mengikuti ritme gambar referensi.
  - `frameExpanded` (`boolean`): Mengizinkan peralihan opsional dari bingkai ponsel `420px` ke mode ruang lebar ketika meninjau tabel silang di layar desktop.
  - `submittedReportSummary`: Menyimpan data laporan yang baru saja berhasil dikirim untuk ditampilkan pada **Layar Konfirmasi Sukses** sebelum pengguna kembali ke daftar laporan.
- **Entitas Real-Time Firestore (Tetap Utuh & Tersinkronisasi)**:
  - Profil publik warga & domisili `RT 001`–`RT 010` (serta subkoleksi privasi email terisolasi).
  - Dokumen laporan warga lengkap dengan foto terkompresi, titik koordinat GPS, alamat hasil reverse-geocoding, kategori 6 sektor, urgensi, status triase, dan instansi tujuan.
  - Catatan pemeriksaan rumah Kampung Bebas Jentik (`jumantikLogs`) per minggu dan per RT.
  - Kotak masuk `notifications` untuk pemicu banner push instan dan laci riwayat pembaruan status.
  - Log `agencyDispatches` untuk pelacakan tiket integrasi instansi pemerintah daerah.

### Interactive Component & State Mapping

- **Layar Sambutan Matcha & Masuk**: Tombol *Masuk Aplikasi* mengubah `welcomeStep` ke `'signin'`; tombol *Masuk dengan Akun Google* memanggil popup autentikasi Firebase dan menginisialisasi profil warga secara otomatis.
- **Karusel Sorotan & Pemilih Kategori Bulat di Beranda**: Indikator titik dan geseran karusel memindahkan kartu sorotan utama (Ringkasan Peta Interaktif, Status ABJ, Cepat Pilih RT); ketukan pada 6 ikon bulat langsung memfilter daftar laporan dan pin peta berdasarkan kategori.
- **Grid Katalog 3 Kolom Mode 10 RT**: Ketukan pada kartu kotak `RT 001`–`RT 010` memilih RT aktif, memfilter peta serta daftar kejadian RT tersebut, menghitung ABJ lokal, menyediakan tombol unduh CSV, dan mengisi otomatis pilihan RT ketika tombol *Buat Laporan RT Ini* ditekan.
- **Panel Kirim Laporan & Layar Konfirmasi**: Mengaktifkan kamera langsung atau pemilih berkas ke dalam bingkai kotak `1:1`, mengambil koordinat GPS presisi + reverse-geocoding alamat jalan, memvalidasi batas panjang teks sesuai aturan keamanan, menyimpan dokumen ke Firestore, lalu menampilkan Layar Konfirmasi Jempol Bulat dengan tombol navigasi tindak lanjut.
- **Triase Admin, Push Notifikasi & Pengiriman API**: Perubahan status laporan oleh admin langsung memperbarui dokumen laporan dan menulis dokumen notifikasi bagi pelapor (memunculkan toast real-time dan notifikasi browser), sementara formulir penerusan instansi mengeksekusi pengiriman payload bertanda tangan HMAC-SHA256 melalui endpoint server.
