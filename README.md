# PDF Studio

Web app lokal untuk manipulasi & menggabungkan file PDF, plus konversi gambar. Semua proses berjalan di komputer kamu sendiri — file tidak dikirim ke server manapun.

Fitur yang digabung dari beberapa script Python sebelumnya: `jpg_to_pdf`, `pdf_to_jpg`, `png_to_jpg`, `pdf_tool_gui`, `pdf_tools`, `pdf_compressor`.

## Fitur

- **Upload banyak file sekaligus** — PDF dan gambar (JPG/PNG/BMP/TIFF/WEBP), drag & drop atau pilih file.
- **Action per baris file**, bisa beberapa sekaligus:
  - 🔃 **Rotate** — putar halaman tertentu (sudut 90/180/270°, arah CW/CCW)
  - ✂ **Extract** — ambil halaman tertentu, urutan bebas (misal `5,1,3-6`)
  - 🗜 **Compress** — kecilkan ukuran PDF (kualitas screen/ebook/printer/prepress, pakai Ghostscript)
  - 🖼 **PDF → JPG** — tiap halaman jadi JPG, hasil di-zip
  - 📄 **Gambar → PDF** — gambar jadi PDF (bisa ikut di-merge)
  - 🖼 **PNG → JPG** — konversi PNG (transparan jadi putih)
- **Arrange** — urutkan ulang file dengan drag-and-drop, atau tombol urut nama A→Z / Z→A.
- **Merge** — gabungkan PDF terproses maupun file asli, sesuai urutan baris (gambar otomatis dikonversi dulu).
- **Review hasil** — setelah proses, muncul ringkasan hasil dulu; baru boleh download tiap file atau semuanya (ZIP).
- **Session persist** — file upload tersimpan di server lokal, list tidak hilang saat halaman di-refresh.

## Persyaratan

- Python 3.9+
- pip packages: `flask`, `pikepdf`, `pillow`, `img2pdf`
- System tools:
  - `poppler-utils` (untuk PDF → JPG, menyediakan `pdftoppm`)
  - `ghostscript` (untuk compress, menyediakan `gs`)

## Instalasi & menjalankan

```bash
# 1. install dependencies Python
pip install flask pikepdf pillow img2pdf

# 2. install tools sistem
#   Debian/Ubuntu:
sudo apt install poppler-utils ghostscript
#   macOS:
brew install poppler ghostscript
#   Windows: install dari https://www.ghostscript.com/download.html
#   dan https://github.com/oschwartz10612/poppler-windows

# 3. jalankan
cd pdf-web-tool
python3 app.py
```

Lalu buka **http://127.0.0.1:5001** di browser.

Opsional: untuk development dengan auto-reload, jalankan `python3 app.py --debug`.

## Ghostscript project-local (tanpa install sistem)

Kalau tidak mau install ghostscript ke sistem, bisa taruh binary `gs` di folder project:

1. Unduh build ghostscript untuk Linux, misalnya paket conda-forge `ghostscript`.
2. Ekstrak, lalu letakkan binary di `vendor/ghostscript/bin/gs`.
3. Aplikasi otomatis memakai binary lokal itu; kalau tidak ada, fallback ke `gs` di PATH sistem.

Folder `vendor/` di-ignore dari git (binary-nya besar), jadi tinggal isi manual di tiap mesin.

## Cara pakai

1. Upload file (PDF/gambar) — beberapa sekaligus.
2. Di baris tiap file, centang action yang diinginkan lalu isi parameternya.
3. Klik **⚙️ Proses File**.
4. Tinjau hasil di modal **Review Hasil Proses**, lalu download per-item atau **⬇ Download Semua (ZIP)**.
5. Untuk menggabungkan, susun urutan file (drag) lalu klik **🔀 Merge Hasil PDF**.

### Format input halaman

- `1-3,5,7-9` → halaman 1 sampai 3, 5, 7 sampai 9
- `5,1,3` → urutan hasil mengikuti urutan yang ditulis
- `5-1` → mundur (5,4,3,2,1)
- Kosong pada Rotate = semua halaman

## Struktur project

```
pdf-web-tool/
├── app.py              # backend Flask + logika PDF
├── templates/
│   └── index.html      # halaman utama
├── static/
│   ├── app.js          # logika frontend
│   └── style.css
├── storage/            # file upload & hasil (di-ignore git)
└── vendor/             # ghostscript lokal opsional (di-ignore git)
```
