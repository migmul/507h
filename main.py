import hashlib
import io
import os
import secrets
import sqlite3
import time
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from functools import wraps
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from flask import (Flask, abort, g, jsonify, redirect, render_template,
                   request, send_file, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

APP_VERSION = "0.2"

BASE = Path(__file__).parent
INSTANCE = BASE / "instance"
INSTANCE.mkdir(exist_ok=True)
DB_PATH = INSTANCE / "507h.db"
UPLOAD_DIR = INSTANCE / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True, mode=0o700)

MAX_PDF = 10 * 1024 * 1024
MAX_DOCS_PER_CONTRACT = 12
KINDS = {"contrat", "aem", "bulletin"}


def load_secret(env_name, filename, generator):
    env = os.environ.get(env_name)
    if env:
        return env
    f = INSTANCE / filename
    if not f.exists():
        f.write_text(generator())
        f.chmod(0o600)
    return f.read_text().strip()


app = Flask(__name__)
app.config.update(
    SECRET_KEY=load_secret("SECRET_KEY", "secret_key", lambda: secrets.token_hex(32)),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("DEV") != "1",
    PERMANENT_SESSION_LIFETIME=timedelta(days=14),
    MAX_CONTENT_LENGTH=MAX_PDF + 1024 * 1024,
)
FERNET = Fernet(load_secret("FILE_KEY", "file_key", lambda: Fernet.generate_key().decode()))
app.jinja_env.globals["app_version"] = APP_VERSION

# ---------- Base de données ----------
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employer TEXT NOT NULL,
  mission TEXT NOT NULL DEFAULT '',
  hours REAL NOT NULL CHECK (hours > 0),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  gross_cents INTEGER CHECK (gross_cents IS NULL OR gross_cents >= 0),
  net_cents INTEGER CHECK (net_cents IS NULL OR net_cents >= 0),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_contracts_user_end ON contracts(user_id, end_date);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('contrat','aem','bulletin')),
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_documents_contract ON documents(contract_id);
"""


def migrate():
    with sqlite3.connect(DB_PATH) as c:
        c.executescript(SCHEMA)
        info = {r[1]: r for r in c.execute("PRAGMA table_info(contracts)")}
        if "comment" not in info:
            c.execute("ALTER TABLE contracts ADD COLUMN comment TEXT NOT NULL DEFAULT ''")
        if info["gross_cents"][3] == 1:  # colonne encore NOT NULL -> reconstruction (v0.2)
            c.executescript("""
            BEGIN;
            CREATE TABLE contracts_new (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
              employer TEXT NOT NULL,
              mission TEXT NOT NULL DEFAULT '',
              hours REAL NOT NULL CHECK (hours > 0),
              start_date TEXT NOT NULL,
              end_date TEXT NOT NULL,
              gross_cents INTEGER CHECK (gross_cents IS NULL OR gross_cents >= 0),
              net_cents INTEGER CHECK (net_cents IS NULL OR net_cents >= 0),
              comment TEXT NOT NULL DEFAULT '',
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO contracts_new
              SELECT id, user_id, employer, mission, hours, start_date, end_date,
                     gross_cents, net_cents, comment, created_at FROM contracts;
            DROP TABLE contracts;
            ALTER TABLE contracts_new RENAME TO contracts;
            CREATE INDEX IF NOT EXISTS idx_contracts_user_end ON contracts(user_id, end_date);
            COMMIT;
            """)


migrate()


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        g.db.execute("PRAGMA journal_mode = WAL")
    return g.db


@app.teardown_appcontext
def close_db(_):
    db = g.pop("db", None)
    if db:
        db.close()


# ---------- Sécurité ----------
def csrf_token():
    if "csrf" not in session:
        session["csrf"] = secrets.token_urlsafe(32)
    return session["csrf"]


app.jinja_env.globals["csrf_token"] = csrf_token


@app.before_request
def check_csrf():
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        sent = request.headers.get("X-CSRF-Token", "")
        if not sent or not secrets.compare_digest(sent, session.get("csrf", "")):
            abort(403)


@app.after_request
def security_headers(resp):
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; object-src 'none'; base-uri 'none'; "
        "frame-ancestors 'none'; form-action 'self'")
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["X-Frame-Options"] = "DENY"
    if request.path.startswith("/api/") or request.path in ("/", "/login"):
        resp.headers["Cache-Control"] = "no-store"
    return resp


@app.errorhandler(403)
def e403(_):
    return jsonify(error="Session expirée, recharge la page"), 403


@app.errorhandler(413)
def e413(_):
    return jsonify(error="Fichier trop volumineux (10 Mo max)"), 413


FAILS = {}
MAX_FAILS, WINDOW = 5, 900


def too_many(key):
    now = time.time()
    FAILS[key] = [t for t in FAILS.get(key, []) if now - t < WINDOW]
    return len(FAILS[key]) >= MAX_FAILS


DUMMY_HASH = generate_password_hash("dummy-password-for-timing")


def login_required(f):
    @wraps(f)
    def wrapper(*a, **kw):
        if "uid" not in session:
            if request.path.startswith("/api/"):
                return jsonify(error="Non authentifié"), 401
            return redirect(url_for("login_page"))
        return f(*a, **kw)
    return wrapper


# ---------- Validation ----------
def err(msg, code=400):
    return jsonify(error=msg), code


def to_cents(v):
    if v is None or str(v).strip() == "":
        return None
    try:
        d = Decimal(str(v).replace(",", "."))
    except (InvalidOperation, ValueError):
        raise ValueError("Montant invalide")
    if d < 0 or d > Decimal("10000000"):
        raise ValueError("Montant hors limites")
    return int((d * 100).to_integral_value())


def parse_contract(data):
    if not isinstance(data, dict):
        raise ValueError("Données invalides")
    employer = " ".join(str(data.get("employer", "")).split())
    mission = str(data.get("mission", "") or "").strip()
    comment = str(data.get("comment", "") or "").strip()
    if not employer or len(employer) > 120:
        raise ValueError("Employeur requis (120 caractères max)")
    if len(mission) > 160:
        raise ValueError("Mission : 160 caractères max")
    if len(comment) > 500:
        raise ValueError("Commentaire : 500 caractères max")
    try:
        hours = float(str(data.get("hours")).replace(",", "."))
    except ValueError:
        raise ValueError("Nombre d'heures invalide")
    if not (0 < hours <= 1000):
        raise ValueError("Heures hors limites")
    try:
        start = date.fromisoformat(str(data.get("start_date")))
        end = date.fromisoformat(str(data.get("end_date")))
    except ValueError:
        raise ValueError("Dates invalides")
    if end < start:
        raise ValueError("La date de fin précède la date de début")
    gross, net = to_cents(data.get("gross")), to_cents(data.get("net"))
    if gross is not None and net is not None and net > gross:
        raise ValueError("Le net ne peut pas dépasser le brut")
    return (employer, mission, hours, start.isoformat(), end.isoformat(),
            gross, net, comment)


def doc_to_dict(r):
    return dict(id=r["id"], kind=r["kind"], name=r["original_name"], size=r["size"])


def row_to_dict(r, docs):
    return dict(id=r["id"], employer=r["employer"], mission=r["mission"],
                hours=r["hours"], start_date=r["start_date"], end_date=r["end_date"],
                gross=None if r["gross_cents"] is None else r["gross_cents"] / 100,
                net=None if r["net_cents"] is None else r["net_cents"] / 100,
                comment=r["comment"], documents=docs)


def user_dir(uid):
    d = UPLOAD_DIR / str(uid)
    d.mkdir(exist_ok=True, mode=0o700)
    return d


def remove_files(uid, stored_names):
    for n in stored_names:
        try:
            (UPLOAD_DIR / str(uid) / n).unlink()
        except FileNotFoundError:
            pass


# ---------- Pages ----------
@app.get("/")
@login_required
def dashboard():
    return render_template("dashboard.html")


@app.get("/login")
def login_page():
    if "uid" in session:
        return redirect(url_for("dashboard"))
    return render_template("auth.html")


# ---------- API auth ----------
@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    pwd = str(data.get("password", ""))
    if "@" not in email or len(email) > 254 or "." not in email.split("@")[-1]:
        return err("Email invalide")
    if not (12 <= len(pwd) <= 200):
        return err("Mot de passe : 12 caractères minimum")
    db = get_db()
    try:
        cur = db.execute("INSERT INTO users(email, password_hash) VALUES (?, ?)",
                         (email, generate_password_hash(pwd)))
        db.commit()
    except sqlite3.IntegrityError:
        return err("Impossible de créer ce compte", 409)
    session.clear()
    session.permanent = True
    session["uid"] = cur.lastrowid
    csrf_token()
    return jsonify(ok=True), 201


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    pwd = str(data.get("password", ""))
    key = f"{request.remote_addr}|{email}"
    if too_many(key):
        return err("Trop de tentatives, réessaie dans 15 minutes", 429)
    u = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    ok = check_password_hash(u["password_hash"] if u else DUMMY_HASH, pwd)
    if not (u and ok):
        FAILS.setdefault(key, []).append(time.time())
        return err("Identifiants incorrects", 401)
    FAILS.pop(key, None)
    session.clear()
    session.permanent = True
    session["uid"] = u["id"]
    csrf_token()
    return jsonify(ok=True)


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


# ---------- API contrats ----------
@app.get("/api/contracts")
@login_required
def list_contracts():
    db, uid = get_db(), session["uid"]
    docs = {}
    for d in db.execute("SELECT * FROM documents WHERE user_id=? ORDER BY id", (uid,)):
        docs.setdefault(d["contract_id"], []).append(doc_to_dict(d))
    rows = db.execute(
        "SELECT * FROM contracts WHERE user_id=? ORDER BY end_date DESC, id DESC",
        (uid,)).fetchall()
    return jsonify([row_to_dict(r, docs.get(r["id"], [])) for r in rows])


@app.get("/api/employers")
@login_required
def list_employers():
    rows = get_db().execute(
        "SELECT employer, COUNT(*) AS n, MAX(end_date) AS last FROM contracts"
        " WHERE user_id=? GROUP BY employer COLLATE NOCASE"
        " ORDER BY n DESC, last DESC LIMIT 50", (session["uid"],)).fetchall()
    return jsonify([r["employer"] for r in rows])


@app.post("/api/contracts")
@login_required
def add_contract():
    try:
        vals = parse_contract(request.get_json(silent=True))
    except ValueError as e:
        return err(str(e))
    db = get_db()
    cur = db.execute(
        "INSERT INTO contracts(user_id, employer, mission, hours, start_date,"
        " end_date, gross_cents, net_cents, comment) VALUES (?,?,?,?,?,?,?,?,?)",
        (session["uid"], *vals))
    db.commit()
    return jsonify(id=cur.lastrowid), 201


@app.put("/api/contracts/<int:cid>")
@login_required
def edit_contract(cid):
    try:
        vals = parse_contract(request.get_json(silent=True))
    except ValueError as e:
        return err(str(e))
    db = get_db()
    cur = db.execute(
        "UPDATE contracts SET employer=?, mission=?, hours=?, start_date=?,"
        " end_date=?, gross_cents=?, net_cents=?, comment=? WHERE id=? AND user_id=?",
        (*vals, cid, session["uid"]))
    db.commit()
    return jsonify(ok=True) if cur.rowcount else err("Introuvable", 404)


@app.delete("/api/contracts/<int:cid>")
@login_required
def delete_contract(cid):
    db, uid = get_db(), session["uid"]
    stored = [r["stored_name"] for r in db.execute(
        "SELECT stored_name FROM documents WHERE contract_id=? AND user_id=?", (cid, uid))]
    cur = db.execute("DELETE FROM contracts WHERE id=? AND user_id=?", (cid, uid))
    db.commit()
    if not cur.rowcount:
        return err("Introuvable", 404)
    remove_files(uid, stored)
    return jsonify(ok=True)


# ---------- API documents ----------
@app.post("/api/contracts/<int:cid>/documents")
@login_required
def upload_document(cid):
    db, uid = get_db(), session["uid"]
    if not db.execute("SELECT 1 FROM contracts WHERE id=? AND user_id=?",
                      (cid, uid)).fetchone():
        return err("Contrat introuvable", 404)
    kind = request.form.get("kind", "")
    f = request.files.get("file")
    if kind not in KINDS or not f:
        return err("Requête invalide")
    n = db.execute("SELECT COUNT(*) FROM documents WHERE contract_id=?", (cid,)).fetchone()[0]
    if n >= MAX_DOCS_PER_CONTRACT:
        return err(f"{MAX_DOCS_PER_CONTRACT} documents maximum par contrat")
    data = f.read(MAX_PDF + 1)
    if len(data) > MAX_PDF:
        return err("Fichier trop volumineux (10 Mo max)", 413)
    if not data.startswith(b"%PDF-"):
        return err("Le fichier n'est pas un PDF valide")
    name = secure_filename(f.filename or "") or "document.pdf"
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    stored = secrets.token_hex(16) + ".bin"
    (user_dir(uid) / stored).write_bytes(FERNET.encrypt(data))
    cur = db.execute(
        "INSERT INTO documents(user_id, contract_id, kind, original_name,"
        " stored_name, size, sha256) VALUES (?,?,?,?,?,?,?)",
        (uid, cid, kind, name[:150], stored, len(data), hashlib.sha256(data).hexdigest()))
    db.commit()
    return jsonify(id=cur.lastrowid), 201


@app.get("/api/documents/<int:did>")
@login_required
def download_document(did):
    uid = session["uid"]
    r = get_db().execute("SELECT * FROM documents WHERE id=? AND user_id=?",
                         (did, uid)).fetchone()
    if not r:
        return err("Introuvable", 404)
    try:
        data = FERNET.decrypt((UPLOAD_DIR / str(uid) / r["stored_name"]).read_bytes())
    except (FileNotFoundError, InvalidToken):
        return err("Fichier indisponible", 410)
    return send_file(io.BytesIO(data), mimetype="application/pdf",
                     as_attachment=True, download_name=r["original_name"])


@app.delete("/api/documents/<int:did>")
@login_required
def delete_document(did):
    db, uid = get_db(), session["uid"]
    r = db.execute("SELECT stored_name FROM documents WHERE id=? AND user_id=?",
                   (did, uid)).fetchone()
    if not r:
        return err("Introuvable", 404)
    db.execute("DELETE FROM documents WHERE id=? AND user_id=?", (did, uid))
    db.commit()
    remove_files(uid, [r["stored_name"]])
    return jsonify(ok=True)


@app.get("/api/summary")
@login_required
def summary():
    today = date.today()
    start = today - timedelta(days=364)
    row = get_db().execute(
        "SELECT COALESCE(SUM(hours),0) AS h, COUNT(*) AS n FROM contracts"
        " WHERE user_id=? AND end_date BETWEEN ? AND ?",
        (session["uid"], start.isoformat(), today.isoformat())).fetchone()
    return jsonify(hours=row["h"], contracts=row["n"], target=507,
                   window_start=start.isoformat(), window_end=today.isoformat())


if __name__ == "__main__":
    app.run(debug=os.environ.get("DEV") == "1", port=5007)