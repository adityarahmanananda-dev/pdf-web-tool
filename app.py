import os
import io
import re
import zipfile
import secrets
import shutil
import subprocess

from flask import Flask, jsonify, render_template, request, send_file, send_from_directory, abort

import img2pdf
import pikepdf
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
UPLOAD_ROOT = os.path.join(BASE, "storage")

app = Flask(__name__)
app.secret_key = "pdf-web-tool"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif", ".webp"}
GS_LEVELS = {
    "screen": "/screen",
    "ebook": "/ebook",
    "printer": "/printer",
    "prepress": "/prepress",
}


# ───────────────────────── helpers ─────────────────────────

def safe_name(name):
    name = os.path.basename(name or "")
    name = re.sub(r"[^\w.\- ]", "_", name)
    return name or "file"


def session_dir(sid=None):
    if not sid or not re.fullmatch(r"[0-9a-f]{16}", sid):
        abort(400)
    d = os.path.join(UPLOAD_ROOT, sid)
    if not os.path.isdir(d):
        abort(404)
    return d


def get_pdf_pages(path):
    try:
        with pikepdf.Pdf.open(path) as pdf:
            return len(pdf.pages)
    except Exception:
        return 0


def parse_range(spec, total):
    idxs = []
    if not spec:
        return idxs
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            if "-" in part:
                a, b = part.split("-", 1)
                a, b = int(a.strip()), int(b.strip())
                step = 1 if a <= b else -1
                for x in range(a, b + step, step):
                    if 1 <= x <= total:
                        idxs.append(x - 1)
            else:
                x = int(part)
                if 1 <= x <= total:
                    idxs.append(x - 1)
        except ValueError:
            continue
    return idxs


def find_gs():
    local = os.path.join(BASE, "vendor", "ghostscript", "bin", "gs")
    if os.path.exists(local):
        return local
    return shutil.which("gs")


def gs_compress(in_path, out_path, level="ebook"):
    settings = GS_LEVELS.get(level, "/ebook")
    gs = find_gs()
    if not gs:
        raise RuntimeError("Ghostscript tidak ditemukan. Letakkan gs di vendor/ghostscript/bin/ atau install system-wide.")
    cmd = [
        gs, "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.4",
        f"-dPDFSETTINGS={settings}", "-dNOPAUSE", "-dBATCH", "-dQUIET",
        "-dAutoRotatePages=/None", "-dPrinted=false",
        f"-sOutputFile={out_path}", in_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not os.path.exists(out_path):
        raise RuntimeError(result.stderr or "Ghostscript gagal")


# ───────────────────────── routes ─────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/upload", methods=["POST"])
def upload():
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "Tidak ada file dikirim"}), 400

    sid = request.form.get("sid", "")
    if sid and re.fullmatch(r"[0-9a-f]{16}", sid):
        d = os.path.join(UPLOAD_ROOT, sid)
        os.makedirs(d, exist_ok=True)
    else:
        sid = secrets.token_hex(8)
        d = os.path.join(UPLOAD_ROOT, sid)
        os.makedirs(d, exist_ok=True)

    items = []
    for f in files:
        if not f or not f.filename:
            continue
        orig = safe_name(f.filename)
        name, ext = os.path.splitext(orig)
        ext = ext.lower()
        fname = orig
        n = 1
        while os.path.exists(os.path.join(d, fname)):
            fname = f"{name}_{n}{ext}"
            n += 1
        path = os.path.join(d, fname)
        f.save(path)

        kind = "pdf" if ext == ".pdf" else ("image" if ext in IMAGE_EXTS else None)
        if kind is None:
            os.remove(path)
            continue

        size = os.path.getsize(path)
        items.append({
            "sid": sid,
            "name": fname,
            "size": size,
            "kind": kind,
            "pages": get_pdf_pages(path) if kind == "pdf" else 0,
        })

    if not items:
        shutil.rmtree(d, ignore_errors=True)
        return jsonify({"error": "File harus berupa PDF atau gambar (JPG/PNG/BMP/TIFF/WEBP)"}), 400

    return jsonify({"sid": sid, "items": items})


@app.route("/api/session/<sid>")
def session_files(sid):
    try:
        d = session_dir(sid)
    except Exception:
        return jsonify({"error": "Session tidak ditemukan"}), 404
    items = []
    for fname in sorted(os.listdir(d)):
        path = os.path.join(d, fname)
        if not os.path.isfile(path):
            continue
        ext = os.path.splitext(fname)[1].lower()
        kind = "pdf" if ext == ".pdf" else ("image" if ext in IMAGE_EXTS else None)
        if kind is None:
            continue
        items.append({
            "name": fname,
            "size": os.path.getsize(path),
            "kind": kind,
            "pages": get_pdf_pages(path) if kind == "pdf" else 0,
        })
    return jsonify({"sid": sid, "items": items})


@app.route("/api/process", methods=["POST"])
def process():
    data = request.get_json(silent=True) or {}
    sid = data.get("sid")
    rows = data.get("rows") or []
    if not sid or not rows:
        return jsonify({"error": "Data tidak valid"}), 400
    d = session_dir(sid)

    results = []
    for row in rows:
        fname = safe_name(row.get("name"))
        path = os.path.join(d, fname)
        rid = row.get("id")
        if not os.path.exists(path):
            results.append({"id": rid, "ok": False, "message": "File tidak ditemukan"})
            continue
        try:
            outs = process_one(d, path, fname, row)
        except Exception as e:
            results.append({"id": rid, "ok": False, "message": str(e)})
            continue
        if not outs:
            results.append({"id": rid, "ok": False, "message": "Tidak ada action yang dipilih"})
        else:
            for o in outs:
                if o.get("ok"):
                    results.append({"id": rid, "ok": True,
                                    "message": o.get("message", "Sukses"),
                                    "download": f"/download/{sid}/{o['url']}",
                                    "name": o["label"]})
                else:
                    results.append({"id": rid, "ok": False,
                                    "message": o.get("message", "Gagal")})

    return jsonify({"results": results})


def process_one(d, path, fname, row):
    kind = row.get("kind")
    if kind == "pdf":
        return process_pdf(d, path, fname, row)
    return process_image(d, path, fname, row)


def process_pdf(d, path, fname, row):
    stem, _ = os.path.splitext(fname)
    rotate = row.get("rotate", {}) or {}
    extract = row.get("extract", {}) or {}
    compress = row.get("compress", {}) or {}
    pdf2jpg = row.get("pdf2jpg", {}) or {}

    rotate_on = rotate.get("enabled")
    extract_on = extract.get("enabled")
    compress_on = compress.get("enabled")
    pdf2jpg_on = pdf2jpg.get("enabled")

    results = []

    if rotate_on or extract_on or compress_on:
        try:
            out_pdf = os.path.join(d, f"{stem}_processed.pdf")
            n = 1
            while os.path.exists(out_pdf):
                out_pdf = os.path.join(d, f"{stem}_processed_{n}.pdf")
                n += 1

            with pikepdf.Pdf.open(path) as pdf:
                total = len(pdf.pages)

                rot_idx = parse_range(rotate.get("pages", ""), total) if rotate_on else []
                if rotate_on and not rotate.get("pages", "").strip():
                    rot_idx = list(range(total))
                ext_idx = parse_range(extract.get("pages", ""), total) if extract_on else []

                stage = path
                tmp_files = []

                if extract_on:
                    with pikepdf.Pdf.open(stage) as pdf2:
                        keep = set(ext_idx)
                        pdf2.pages[:] = [p for i, p in enumerate(pdf2.pages) if i in keep]
                        tmp_extract = os.path.join(d, f"{stem}_stage.pdf")
                        pdf2.save(tmp_extract)
                    tmp_files.append(tmp_extract)
                    stage = tmp_extract

                # rotation dihitung pada penomoran halaman hasil extract
                if extract_on:
                    pos_map = {orig: pos for pos, orig in enumerate(ext_idx)}
                    rot_stage = [pos_map[i] for i in rot_idx if i in pos_map]
                else:
                    rot_stage = rot_idx

                if compress_on:
                    tmp_comp = os.path.join(d, f"{stem}_stage2.pdf")
                    gs_compress(stage, tmp_comp, compress.get("quality", "ebook"))
                    tmp_files.append(tmp_comp)
                    stage = tmp_comp

                with pikepdf.Pdf.open(stage) as pdf3:
                    angle = int(rotate.get("angle", 90))
                    if rotate.get("dir") == "kiri":
                        angle = -angle
                    for i in rot_stage:
                        page = pdf3.pages[i]
                        cur = int(page.get("/Rotate") or 0)
                        new_rot = (cur + angle) % 360
                        if new_rot == 0:
                            if "/Rotate" in page.obj:
                                del page.obj["/Rotate"]
                        else:
                            page.obj["/Rotate"] = new_rot
                    pdf3.save(out_pdf)

            for t in tmp_files:
                if os.path.exists(t):
                    os.remove(t)

            results.append({"ok": True,
                            "url": os.path.basename(out_pdf),
                            "label": os.path.basename(out_pdf)})
        except Exception as e:
            results.append({"ok": False, "message": f"Gagal proses PDF: {e}"})

    if pdf2jpg_on:
        try:
            dpi = int(pdf2jpg.get("dpi", 150))
            prefix = os.path.join(d, f"{stem}_page")
            cmd = ["pdftoppm", "-jpeg", "-r", str(dpi), "-jpegopt", "quality=95", path, prefix]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0 or not os.path.exists(prefix + "-1.jpg"):
                raise RuntimeError(result.stderr or "Konversi PDF → JPG gagal. Pastikan poppler-utils terinstall.")
            jpgs = sorted(f for f in os.listdir(d) if f.startswith(f"{stem}_page-") and f.endswith(".jpg"))
            zip_name = f"{stem}_jpg.zip"
            zip_path = os.path.join(d, zip_name)
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
                for j in jpgs:
                    z.write(os.path.join(d, j), arcname=j)
                    os.remove(os.path.join(d, j))
            results.append({"ok": True, "url": zip_name, "label": zip_name})
        except Exception as e:
            results.append({"ok": False, "message": str(e)})

    return results


def process_image(d, path, fname, row):
    stem, _ = os.path.splitext(fname)
    png2jpg = row.get("png2jpg", {}).get("enabled")
    to_pdf = row.get("to_pdf", {}).get("enabled")

    results = []

    if png2jpg:
        try:
            out_jpg = os.path.join(d, f"{stem}.jpg")
            with Image.open(path) as img:
                if img.mode in ("RGBA", "LA", "P"):
                    img = img.convert("RGBA")
                    bg = Image.new("RGB", img.size, (255, 255, 255))
                    bg.paste(img, mask=img.split()[-1])
                    img = bg
                else:
                    img = img.convert("RGB")
                img.save(out_jpg, "JPEG", quality=95, subsampling=0, optimize=True)
            results.append({"ok": True, "url": f"{stem}.jpg", "label": f"{stem}.jpg"})
        except Exception as e:
            results.append({"ok": False, "message": str(e)})

    if to_pdf:
        try:
            out_pdf = os.path.join(d, f"{stem}.pdf")
            n = 1
            while os.path.exists(out_pdf):
                out_pdf = os.path.join(d, f"{stem}_{n}.pdf")
                n += 1
            with Image.open(path) as img:
                if img.mode in ("RGBA", "LA", "P"):
                    img = img.convert("RGB")
                img_bytes = io.BytesIO()
                img.save(img_bytes, format="JPEG", quality=95)
            with open(out_pdf, "wb") as f:
                f.write(img2pdf.convert(img_bytes.getvalue()))
            results.append({"ok": True, "url": os.path.basename(out_pdf), "label": os.path.basename(out_pdf)})
        except Exception as e:
            results.append({"ok": False, "message": str(e)})

    return results


@app.route("/api/merge", methods=["POST"])
def merge():
    data = request.get_json(silent=True) or {}
    sid = data.get("sid")
    items = data.get("items") or []
    if not sid or not items:
        return jsonify({"error": "Data tidak valid"}), 400
    d = session_dir(sid)

    merged = pikepdf.Pdf.new()
    used = []
    skipped = []
    for it in items:
        name = safe_name(it.get("name"))
        kind = it.get("kind")
        p = os.path.join(d, name)
        if not os.path.exists(p):
            continue
        if kind == "image":
            with Image.open(p) as img:
                if img.mode in ("RGBA", "LA", "P"):
                    img = img.convert("RGB")
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=95)
            try:
                pdf_bytes = img2pdf.convert(buf.getvalue())
                with pikepdf.Pdf.open(io.BytesIO(pdf_bytes)) as src:
                    for pg in src.pages:
                        merged.pages.append(pg)
                used.append(name)
            except Exception:
                skipped.append(name)
            continue
        if not name.lower().endswith(".pdf"):
            continue
        try:
            with pikepdf.Pdf.open(p) as src:
                for pg in src.pages:
                    merged.pages.append(pg)
            used.append(name)
        except Exception:
            skipped.append(name)

    if not used:
        return jsonify({"error": "Tidak ada file yang bisa di-merge"}), 400

    out_name = f"merged_{len(used)}file.pdf"
    n = 1
    while os.path.exists(os.path.join(d, out_name)):
        out_name = f"merged_{len(used)}file_{n}.pdf"
        n += 1
    merged.save(os.path.join(d, out_name))

    return jsonify({"ok": True, "download": f"/download/{sid}/{out_name}", "name": out_name,
                    "skipped": skipped})


@app.route("/api/zip-all", methods=["POST"])
def zip_all():
    data = request.get_json(silent=True) or {}
    sid = data.get("sid")
    files = data.get("files") or []
    if not sid:
        return jsonify({"error": "Data tidak valid"}), 400
    d = session_dir(sid)

    zip_path = os.path.join(d, "semua_hasil.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for fname in files:
            name = safe_name(fname)
            p = os.path.join(d, name)
            if os.path.exists(p):
                z.write(p, arcname=name)
    return jsonify({"ok": True, "download": f"/download/{sid}/semua_hasil.zip"})


@app.route("/download/<sid>/<path:fname>")
def download(sid, fname):
    d = session_dir(sid)
    name = safe_name(fname)
    return send_from_directory(d, name, as_attachment=True)


@app.route("/api/clear/<sid>", methods=["POST"])
def clear(sid):
    d = session_dir(sid)
    shutil.rmtree(d, ignore_errors=True)
    return jsonify({"ok": True})


if __name__ == "__main__":
    import sys
    debug = "--debug" in sys.argv
    app.run(host="127.0.0.1", port=5001, debug=debug)
