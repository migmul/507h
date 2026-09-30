import hashlib
import io
import os
import secrets
import sqlite3
import time
import json, shutil, zipfile
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from functools import wraps
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from flask import (Flask, abort, g, jsonify, redirect, render_template, request, send_file, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

APP_VERSION = "0.5.1"

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
  session_version INTEGER NOT NULL DEFAULT 0,
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
CREATE TABLE IF NOT EXISTS are_rights (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  annexe INTEGER NOT NULL CHECK (annexe IN (8, 10)),
  fct_date TEXT NOT NULL,
  start_date TEXT NOT NULL,
  anniversary_date TEXT,
  aj_net_cents INTEGER CHECK (aj_net_cents IS NULL OR aj_net_cents > 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


def migrate():
    with sqlite3.connect(DB_PATH) as c:
        c.executescript(SCHEMA)
        info = {r[1]: r for r in c.execute("PRAGMA table_info(contracts)")}
        if "comment" not in info:
            c.execute("ALTER TABLE contracts ADD COLUMN comment TEXT NOT NULL DEFAULT ''")
        ucols = {r[1] for r in c.execute("PRAGMA table_info(users)")}
        if "session_version" not in ucols:
            c.execute("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0")
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
        rcols = {r[1] for r in c.execute("PRAGMA table_info(are_rights)")}
        if "aj_net_cents" not in rcols:
            c.execute("ALTER TABLE are_rights ADD COLUMN aj_net_cents INTEGER "
                      "CHECK (aj_net_cents IS NULL OR aj_net_cents > 0)")


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
        if not sent or not secrets.compare_digest(sent.encode(), session.get("csrf", "").encode()):
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


def current_uid():
    uid = session.get("uid")
    if not uid:
        return None
    u = get_db().execute("SELECT session_version FROM users WHERE id=?", (uid,)).fetchone()
    if not u or u["session_version"] != session.get("sv"):
        session.clear()
        return None
    return uid


def login_required(f):
    @wraps(f)
    def wrapper(*a, **kw):
        if current_uid() is None:
            if request.path.startswith("/api/"):
                return jsonify(error="Non authentifié"), 401
            return redirect(url_for("login_page"))
        return f(*a, **kw)
    return wrapper


def valid_email(e):
    return (len(e) <= 254 and " " not in e and "@" in e
            and "." in e.split("@")[-1] and not e.startswith("@"))


def check_password(uid, pwd):
    """None si le mot de passe est bon, sinon une réponse d'erreur."""
    key = f"acct|{uid}"
    if too_many(key):
        return err("Trop de tentatives, réessaie dans 15 minutes", 429)
    u = get_db().execute("SELECT password_hash FROM users WHERE id=?", (uid,)).fetchone()
    if not (u and check_password_hash(u["password_hash"], pwd)):
        FAILS.setdefault(key, []).append(time.time())
        return err("Mot de passe actuel incorrect", 403)
    FAILS.pop(key, None)
    return None


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
    if current_uid():
        return redirect(url_for("dashboard"))
    return render_template("auth.html")

@app.get("/account")
@login_required
def account_page():
    return render_template("account.html")


# ---------- API auth ----------
@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    pwd = str(data.get("password", ""))
    if not valid_email(email):
        return err("Email invalide")
    if not (12 <= len(pwd) <= 200):
        return err("Mot de passe : 12 caractères minimum")
    if pwd != str(data.get("password_confirm", "")):
        return err("Les mots de passe ne correspondent pas")
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
    session["sv"] = 0
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
    session["sv"] = u["session_version"]
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
    db, uid = get_db(), session["uid"]
    today = date.today()
    start, mode = today - timedelta(days=364), "rolling"
    fct_date = da = None
    r = db.execute("SELECT fct_date, anniversary_date FROM are_rights WHERE user_id=?",
                   (uid,)).fetchone()
    if r:
        fct = date.fromisoformat(r["fct_date"])
        fct_date = fct.isoformat()
        da = r["anniversary_date"] or add_year(fct).isoformat()
        if fct + timedelta(days=1) > start:     # heures déjà utilisées : exclues
            start, mode = fct + timedelta(days=1), "since_fct"
    t = period_totals(db, uid, start, today)
    return jsonify(hours=t["hours"], contracts=t["contracts"], target=HOURS_TARGET,
                   window_start=start.isoformat(), window_end=today.isoformat(),
                   mode=mode, fct_date=fct_date, anniversary_date=da)

# ---------- API compte ----------
def bump_sessions(db, uid):
    db.execute("UPDATE users SET session_version = session_version + 1 WHERE id=?", (uid,))
    db.commit()
    session["sv"] = db.execute("SELECT session_version FROM users WHERE id=?", (uid,)).fetchone()[0]


@app.get("/api/account")
@login_required
def account_info():
    db, uid = get_db(), session["uid"]
    u = db.execute("SELECT email, created_at FROM users WHERE id=?", (uid,)).fetchone()
    nc = db.execute("SELECT COUNT(*) FROM contracts WHERE user_id=?", (uid,)).fetchone()[0]
    nd = db.execute("SELECT COUNT(*) FROM documents WHERE user_id=?", (uid,)).fetchone()[0]
    return jsonify(email=u["email"], created_at=u["created_at"], contracts=nc, documents=nd)


@app.post("/api/account/email")
@login_required
def change_email():
    d = request.get_json(silent=True) or {}
    uid = session["uid"]
    email = str(d.get("email", "")).strip().lower()
    if not valid_email(email):
        return err("Email invalide")
    bad = check_password(uid, str(d.get("password", "")))
    if bad:
        return bad
    db = get_db()
    try:
        db.execute("UPDATE users SET email=? WHERE id=?", (email, uid))
        db.commit()
    except sqlite3.IntegrityError:
        return err("Cette adresse n'est pas disponible", 409)
    return jsonify(ok=True, email=email)


@app.post("/api/account/password")
@login_required
def change_password():
    d = request.get_json(silent=True) or {}
    uid = session["uid"]
    current, new = str(d.get("current", "")), str(d.get("new", ""))
    if not (12 <= len(new) <= 200):
        return err("Nouveau mot de passe : 12 caractères minimum")
    if new != str(d.get("confirm", "")):
        return err("Les mots de passe ne correspondent pas")
    if new == current:
        return err("Le nouveau mot de passe doit être différent de l'ancien")
    bad = check_password(uid, current)
    if bad:
        return bad
    db = get_db()
    db.execute("UPDATE users SET password_hash=? WHERE id=?",
               (generate_password_hash(new), uid))
    bump_sessions(db, uid)   # déconnecte les autres appareils, garde celui-ci
    return jsonify(ok=True)


@app.post("/api/account/logout-all")
@login_required
def logout_all():
    bump_sessions(get_db(), session["uid"])
    return jsonify(ok=True)


@app.get("/api/account/export")
@login_required
def export_account():
    db, uid = get_db(), session["uid"]
    u = db.execute("SELECT email, created_at FROM users WHERE id=?", (uid,)).fetchone()
    docs = db.execute("SELECT * FROM documents WHERE user_id=? ORDER BY id", (uid,)).fetchall()
    by_contract = {}
    for d in docs:
        by_contract.setdefault(d["contract_id"], []).append(doc_to_dict(d))
    contracts = [row_to_dict(r, by_contract.get(r["id"], [])) for r in db.execute(
        "SELECT * FROM contracts WHERE user_id=? ORDER BY end_date DESC", (uid,))]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("donnees.json", json.dumps(
            {"version": APP_VERSION, "email": u["email"], "created_at": u["created_at"],
             "droit_are": (build_overview(db, uid) or {}).get("settings"),
             "contracts": contracts}, ensure_ascii=False, indent=2))
        for d in docs:
            try:
                raw = FERNET.decrypt((UPLOAD_DIR / str(uid) / d["stored_name"]).read_bytes())
            except (FileNotFoundError, InvalidToken):
                continue
            z.writestr(f"documents/{d['id']}_{d['kind']}_{d['original_name']}", raw)
    buf.seek(0)
    return send_file(buf, mimetype="application/zip", as_attachment=True,
                     download_name="507h-export.zip")


@app.delete("/api/account")
@login_required
def delete_account():
    d = request.get_json(silent=True) or {}
    uid = session["uid"]
    if d.get("confirm") != "SUPPRIMER":
        return err("Tape SUPPRIMER pour confirmer")
    bad = check_password(uid, str(d.get("password", "")))
    if bad:
        return bad
    db = get_db()
    db.execute("DELETE FROM users WHERE id=?", (uid,))   # cascade : contrats + documents
    db.commit()
    shutil.rmtree(UPLOAD_DIR / str(uid), ignore_errors=True)
    session.clear()
    return jsonify(ok=True)

# ---------- Intermittence : règles ARE ----------
HOURS_TARGET = 507

def add_year(d):
    try:
        return d.replace(year=d.year + 1)
    except ValueError:          # 29 février
        return d.replace(year=d.year + 1, day=28)


def period_totals(db, uid, start, end):
    """Heures et salaires bruts des contrats sur [start, end], proratisés au jour."""
    zero = {"hours": 0.0, "gross": 0.0, "contracts": 0, "missing_gross": 0}
    if start > end:
        return zero
    hours = gross = 0.0
    missing = n = 0
    rows = db.execute(
        "SELECT hours, start_date, end_date, gross_cents FROM contracts"
        " WHERE user_id=? AND end_date >= ? AND start_date <= ?",
        (uid, start.isoformat(), end.isoformat()))
    for r in rows:
        s, e = date.fromisoformat(r["start_date"]), date.fromisoformat(r["end_date"])
        ratio = ((min(e, end) - max(s, start)).days + 1) / ((e - s).days + 1)
        hours += r["hours"] * ratio
        if r["gross_cents"] is None:
            missing += 1
        else:
            gross += r["gross_cents"] / 100 * ratio
        n += 1
    return {"hours": round(hours, 2), "gross": round(gross, 2),
            "contracts": n, "missing_gross": missing}


def build_overview(db, uid):
    r = db.execute("SELECT * FROM are_rights WHERE user_id=?", (uid,)).fetchone()
    if not r:
        return None
    today = date.today()
    fct = date.fromisoformat(r["fct_date"])
    start = date.fromisoformat(r["start_date"])
    da_auto = add_year(fct)
    da = date.fromisoformat(r["anniversary_date"]) if r["anniversary_date"] else da_auto
    days_left = (da - today).days
    status = "expired" if days_left < 0 else "soon" if days_left <= 15 else "active"
    total_days = (da - start).days + 1

    cur_tot = period_totals(db, uid, fct - timedelta(days=364), fct)
    aj_net = None if r["aj_net_cents"] is None else r["aj_net_cents"] / 100

    win_start = fct + timedelta(days=1)
    total = period_totals(db, uid, win_start, da)
    done = period_totals(db, uid, win_start, min(da, today))
    needed = max(0.0, HOURS_TARGET - total["hours"])
    per_week = needed / (days_left / 7) if days_left > 0 and needed > 0 else None

    return {
        "annexe": r["annexe"],
        "fct_date": fct.isoformat(), "start_date": start.isoformat(),
        "anniversary_date": da.isoformat(), "anniversary_auto": da_auto.isoformat(),
        "anniversary_overridden": bool(r["anniversary_date"]),
        "exam_date": (da + timedelta(days=1)).isoformat(),
        "days_left": days_left, "status": status,
        "elapsed_pct": max(0, min(100, round((today - start).days / max(1, total_days) * 100))),
        "total_days": total_days,
        "current": {"period_start": (fct - timedelta(days=364)).isoformat(),
                    "period_end": fct.isoformat(), "totals": cur_tot, "aj_net": aj_net},
        "projection": {
            "window_start": win_start.isoformat(), "window_end": da.isoformat(),
            "hours_total": total["hours"], "hours_done": done["hours"],
            "hours_planned": round(total["hours"] - done["hours"], 2),
            "hours_needed": round(needed, 1), "per_week": per_week},
        "settings": {
            "annexe": r["annexe"], "fct_date": r["fct_date"], "start_date": r["start_date"],
            "anniversary_date": r["anniversary_date"], "aj_net": aj_net},
    }


def parse_rights(d):
    if not isinstance(d, dict):
        raise ValueError("Données invalides")

    def dt(key, required=False):
        v = d.get(key)
        if v in (None, ""):
            if required:
                raise ValueError("Date de fin de contrat (FCT) requise")
            return None
        try:
            return date.fromisoformat(str(v))
        except ValueError:
            raise ValueError(f"Date invalide : {key}")

    try:
        annexe = int(d.get("annexe"))
    except (TypeError, ValueError):
        raise ValueError("Annexe invalide")
    if annexe not in (8, 10):
        raise ValueError("Annexe invalide")
    fct = dt("fct_date", True)
    start = dt("start_date") or fct + timedelta(days=1)
    da = dt("anniversary_date")
    if start <= fct:
        raise ValueError("Le début d'indemnisation doit suivre la fin de contrat")
    if da and da <= start:
        raise ValueError("La date anniversaire doit suivre le début d'indemnisation")
    ajn = to_cents(d.get("aj_net"))
    if ajn is not None and not (0 < ajn <= 50000):
        raise ValueError("AJ hors limites (0 à 500 €)")
    return (annexe, fct.isoformat(), start.isoformat(),
            da.isoformat() if da else None, ajn)


@app.get("/intermittence")
@login_required
def intermittence_page():
    return render_template("intermittence.html")


@app.get("/api/intermittence")
@login_required
def get_intermittence():
    return jsonify(overview=build_overview(get_db(), session["uid"]))


@app.put("/api/intermittence")
@login_required
def save_intermittence():
    try:
        vals = parse_rights(request.get_json(silent=True))
    except ValueError as e:
        return err(str(e))
    db, uid = get_db(), session["uid"]
    db.execute(
        "INSERT INTO are_rights(user_id, annexe, fct_date, start_date, anniversary_date,"
        " aj_net_cents) VALUES (?,?,?,?,?,?)"
        " ON CONFLICT(user_id) DO UPDATE SET annexe=excluded.annexe,"
        " fct_date=excluded.fct_date, start_date=excluded.start_date,"
        " anniversary_date=excluded.anniversary_date, aj_net_cents=excluded.aj_net_cents,"
        " updated_at=CURRENT_TIMESTAMP",
        (uid, *vals))
    db.commit()
    return jsonify(overview=build_overview(db, uid))


@app.delete("/api/intermittence")
@login_required
def reset_intermittence():
    db = get_db()
    db.execute("DELETE FROM are_rights WHERE user_id=?", (session["uid"],))
    db.commit()
    return jsonify(ok=True)

if __name__ == "__main__":
    app.run(debug=os.environ.get("DEV") == "1", port=5007)