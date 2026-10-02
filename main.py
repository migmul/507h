import hashlib
import io
import os
import secrets
import sqlite3
import time
import json, shutil, zipfile
import re
import statistics
import base64
import hmac
import smtplib
import ssl
import struct
import threading
import segno
import unicodedata
from dotenv import load_dotenv
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from urllib.parse import quote
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from functools import wraps
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from flask import (
    Flask, Response, abort, g, jsonify, redirect, render_template,
    request, send_file, session, url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename
from werkzeug.middleware.proxy_fix import ProxyFix

APP_VERSION = "0.18"

BASE = Path(__file__).parent
load_dotenv(BASE / ".env")
INSTANCE = BASE / "instance"
INSTANCE.mkdir(exist_ok=True)
DB_PATH = INSTANCE / "507h.db"
UPLOAD_DIR = INSTANCE / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True, mode=0o700)

MAX_IMPORT_BYTES = 2 * 1024 * 1024
MAX_IMPORT_CONTRACTS = 2000
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

# Derrière un reverse proxy : lit l'IP, le protocole et l'hôte réels dans X-Forwarded-*
hops = int(os.environ.get("PROXY_HOPS", "0") or 0)
if hops:
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=hops, x_proto=hops, x_host=hops)

FERNET = Fernet(load_secret("FILE_KEY", "file_key", lambda: Fernet.generate_key().decode()))
app.jinja_env.globals["app_version"] = APP_VERSION

if os.environ.get("MAIL_CONSOLE") == "1":
    app.logger.warning("MAIL_CONSOLE actif : le contenu des e-mails (liens compris) "
                       "est écrit dans les journaux.")
if os.environ.get("SMTP_HOST") and not os.environ.get("APP_BASE_URL"):
    app.logger.warning("SMTP_HOST défini sans APP_BASE_URL : l'envoi d'e-mails est désactivé.")

# ---------- Base de données ----------
SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    session_version INTEGER NOT NULL DEFAULT 0,
    email_verified INTEGER NOT NULL DEFAULT 0,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    totp_last_step INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS email_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset', 'email_change')),
    token_hash TEXT NOT NULL UNIQUE,
    new_email TEXT,
    expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, purpose);
CREATE TABLE IF NOT EXISTS recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_codes(user_id);
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
  job_title TEXT NOT NULL DEFAULT '',
  days_worked REAL CHECK (days_worked IS NULL OR days_worked > 0),
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
CREATE TABLE IF NOT EXISTS rights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  annexe INTEGER NOT NULL CHECK (annexe IN (8, 10)),
  opening_type TEXT NOT NULL DEFAULT 'renewal' CHECK (opening_type IN ('first','renewal','anticipated')),
  fct_date TEXT NOT NULL,
  start_date TEXT NOT NULL,
  anniversary_date TEXT,
  aj_net_cents INTEGER CHECK (aj_net_cents IS NULL OR aj_net_cents > 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rights_user ON rights(user_id, start_date);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paid_on TEXT NOT NULL,
  month_covered TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  days_paid INTEGER CHECK (days_paid IS NULL OR days_paid BETWEEN 0 AND 31),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, paid_on);
CREATE TABLE IF NOT EXISTS day_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    employer_match TEXT NOT NULL,
    max_days INTEGER NOT NULL CHECK (max_days BETWEEN 1 AND 366)
);
CREATE INDEX IF NOT EXISTS idx_limits_user ON day_limits(user_id);
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
        for col, ddl in (
                ("email_verified", "INTEGER NOT NULL DEFAULT 0"),
                ("totp_secret", "TEXT"),
                ("totp_enabled", "INTEGER NOT NULL DEFAULT 0"),
                ("totp_last_step", "INTEGER NOT NULL DEFAULT 0")):
            if col not in ucols:
                c.execute(f"ALTER TABLE users ADD COLUMN {col} {ddl}")
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
        migrate_rights(c)
        if "job_title" not in {r[1] for r in c.execute("PRAGMA table_info(contracts)")}:
            c.execute("ALTER TABLE contracts ADD COLUMN job_title TEXT NOT NULL DEFAULT ''")
        if "days_worked" not in {r[1] for r in c.execute("PRAGMA table_info(contracts)")}:
            c.execute("ALTER TABLE contracts ADD COLUMN days_worked REAL "
                      "CHECK (days_worked IS NULL OR days_worked > 0)")

def migrate_rights(c):
    cols = {r[1] for r in c.execute("PRAGMA table_info(are_rights)")}
    if not cols:        # installation neuve, ou déjà migrée
        return
    if "aj_net_cents" not in cols:
        c.execute("ALTER TABLE are_rights ADD COLUMN aj_net_cents INTEGER")
    c.execute(
        "INSERT INTO rights(user_id, annexe, fct_date, start_date, anniversary_date,"
        " aj_net_cents, opening_type)"
        " SELECT user_id, annexe, fct_date, start_date, anniversary_date,"
        " aj_net_cents, 'renewal' FROM are_rights")
    c.execute("ALTER TABLE are_rights RENAME TO are_rights_old")

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

# ---------- E-mails, jetons et double authentification ----------
TOKEN_TTL = {"verify": 48 * 3600, "reset": 3600, "email_change": 24 * 3600}
TOTP_STEP = 30
EMAIL_RE = re.compile(r"^[^@\s<>,;\"']+@[^@\s<>,;\"']+\.[^@\s<>,;\"']+$")


def valid_email(e):
    return len(e) <= 254 and bool(EMAIL_RE.match(e))


def hit(key, limit, window=WINDOW):
    """Enregistre une tentative ; True si la limite est dépassée."""
    now = time.time()
    if len(FAILS) > 5000:       # évite que le dictionnaire grossisse indéfiniment
        for k in [k for k, v in FAILS.items() if not v or now - v[-1] > WINDOW]:
            del FAILS[k]
    FAILS[key] = [t for t in FAILS.get(key, []) if now - t < window]
    if len(FAILS[key]) >= limit:
        return True
    FAILS[key].append(now)
    return False


def hash_token(raw):
    return hmac.new(app.config["SECRET_KEY"].encode(), raw.encode(), hashlib.sha256).hexdigest()


# --- E-mails ---
def mail_mode():
    if os.environ.get("MAIL_CONSOLE") == "1":
        return "console"
    if os.environ.get("SMTP_HOST") and os.environ.get("APP_BASE_URL"):
        return "smtp"
    return None


def mail_enabled():
    return mail_mode() is not None


def base_url():
    # APP_BASE_URL uniquement : l'en-tête Host peut être falsifié
    return os.environ.get("APP_BASE_URL", "").rstrip("/") or request.host_url.rstrip("/")


def deliver(msg):
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    ctx = ssl.create_default_context()
    try:
        if os.environ.get("SMTP_SSL") == "1":
            server = smtplib.SMTP_SSL(host, port, context=ctx, timeout=15)
        else:
            server = smtplib.SMTP(host, port, timeout=15)
            if os.environ.get("SMTP_STARTTLS", "1") == "1":
                server.starttls(context=ctx)
        with server:
            user = os.environ.get("SMTP_USER")
            if user:
                server.login(user, os.environ.get("SMTP_PASSWORD", ""))
            server.send_message(msg)
    except Exception:
        app.logger.exception("Échec d'envoi d'e-mail")


def send_mail(to, subject, text):
    if os.environ.get("MAIL_CONSOLE") == "1":
        app.logger.warning("MAIL à %s : %s\n%s", to, subject, text)
    if mail_mode() != "smtp":
        return
    msg = EmailMessage()
    msg["From"] = os.environ.get("SMTP_FROM") or os.environ.get("SMTP_USER", "")
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    msg.set_content(text)
    threading.Thread(target=deliver, args=(msg,), daemon=True).start()


# --- Jetons de lien ---
def make_token(db, uid, purpose, new_email=None):
    raw = secrets.token_urlsafe(32)
    db.execute("DELETE FROM email_tokens WHERE expires_at < ?", (int(time.time()),))
    db.execute("DELETE FROM email_tokens WHERE user_id=? AND purpose=?", (uid, purpose))
    db.execute(
        "INSERT INTO email_tokens(user_id, purpose, token_hash, new_email, expires_at)"
        " VALUES (?,?,?,?,?)",
        (uid, purpose, hash_token(raw), new_email, int(time.time()) + TOKEN_TTL[purpose]))
    db.commit()
    return raw


def consume_token(db, raw, purposes):
    """Retourne la ligne du jeton s'il est valide, et le supprime (usage unique)."""
    if not raw or len(raw) > 200:
        return None
    marks = ",".join("?" * len(purposes))
    row = db.execute(
        f"SELECT * FROM email_tokens WHERE token_hash=? AND purpose IN ({marks})",
        (hash_token(raw), *purposes)).fetchone()
    if not row:
        return None
    db.execute("DELETE FROM email_tokens WHERE id=?", (row["id"],))
    db.commit()
    return row if row["expires_at"] >= time.time() else None


def send_verification(uid, email):
    raw = make_token(get_db(), uid, "verify")
    send_mail(email, "507h – Confirme ton adresse e-mail",
              "Bonjour,\n\nConfirme ton adresse e-mail pour 507h en ouvrant ce lien "
              f"(valable 48 heures) :\n{base_url()}/verify?token={raw}\n\n"
              "Si tu n'es pas à l'origine de cette demande, ignore ce message.\n")


# --- Double authentification (TOTP, RFC 6238) ---
def totp_at(secret_b32, step):
    h = hmac.new(base64.b32decode(secret_b32), struct.pack(">Q", step), hashlib.sha1).digest()
    o = h[-1] & 0x0F
    return f"{(struct.unpack('>I', h[o:o + 4])[0] & 0x7FFFFFFF) % 1000000:06d}"


def check_totp(secret_b32, code, last_step):
    """Retourne le pas de temps validé, ou None. Refuse un pas déjà utilisé."""
    code = re.sub(r"\s", "", str(code or ""))
    if not re.fullmatch(r"\d{6}", code):
        return None
    now_step = int(time.time() // TOTP_STEP)
    for step in (now_step - 1, now_step, now_step + 1):
        if step > (last_step or 0) and hmac.compare_digest(totp_at(secret_b32, step), code):
            return step
    return None


def new_recovery_codes(db, uid, n=10):
    db.execute("DELETE FROM recovery_codes WHERE user_id=?", (uid,))
    codes = []
    for _ in range(n):
        raw = secrets.token_hex(6)
        codes.append("-".join(raw[i:i + 4] for i in (0, 4, 8)))
        db.execute("INSERT INTO recovery_codes(user_id, code_hash) VALUES (?,?)",
                   (uid, hash_token(raw)))
    return codes


def verify_second_factor(db, uid, code):
    """Retourne 'totp', 'recovery' ou None."""
    u = db.execute("SELECT totp_secret, totp_last_step FROM users"
                   " WHERE id=? AND totp_enabled=1", (uid,)).fetchone()
    if not u:
        return None
    raw = str(code or "").strip()
    try:
        secret = FERNET.decrypt(u["totp_secret"].encode()).decode()
    except InvalidToken:
        app.logger.error("Secret TOTP illisible pour l'utilisateur %s (FILE_KEY modifiée ?)", uid)
        return None
    step = check_totp(secret, raw, u["totp_last_step"])
    if step:
        db.execute("UPDATE users SET totp_last_step=? WHERE id=?", (step, uid))
        db.commit()
        return "totp"
    cleaned = re.sub(r"[\s-]", "", raw).lower()
    if re.fullmatch(r"[0-9a-f]{12}", cleaned):
        cur = db.execute("DELETE FROM recovery_codes WHERE user_id=? AND code_hash=?",
                         (uid, hash_token(cleaned)))
        db.commit()
        if cur.rowcount:
            return "recovery"
    return None


def second_factor_ok(db, uid, code):
    """Retourne (type, None) si valide, sinon (None, réponse d'erreur)."""
    key = f"2fa|{uid}"
    if too_many(key):
        return None, err("Trop de tentatives, réessaie dans 15 minutes", 429)
    kind = verify_second_factor(db, uid, code)
    if not kind:
        FAILS.setdefault(key, []).append(time.time())
        return None, err("Code incorrect", 403)
    FAILS.pop(key, None)
    return kind, None

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
    job_title = " ".join(str(data.get("job_title", "") or "").split())
    if not employer or len(employer) > 120:
        raise ValueError("Employeur requis (120 caractères max)")
    if len(mission) > 160:
        raise ValueError("Mission : 160 caractères max")
    if len(comment) > 500:
        raise ValueError("Commentaire : 500 caractères max")
    if len(job_title) > 80:
        raise ValueError("Poste : 80 caractères max")
    try:
        hours = float(str(data.get("hours")).replace(",", "."))
    except ValueError:
        raise ValueError("Nombre d'heures invalide")
    if not (0 < hours <= 1000):
        raise ValueError("Heures hors limites")
    raw_days = data.get("days_worked")
    if raw_days in (None, ""):
        days_worked = None
    else:
        try:
            days_worked = float(str(raw_days).replace(",", "."))
        except ValueError:
            raise ValueError("Jours travaillés invalides")
        if not (0 < days_worked <= 366):
            raise ValueError("Jours travaillés : entre 0 et 366")
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
            gross, net, comment, job_title, days_worked)


def doc_to_dict(r):
    return dict(id=r["id"], kind=r["kind"], name=r["original_name"], size=r["size"])


def row_to_dict(r, docs):
    return dict(id=r["id"], employer=r["employer"], mission=r["mission"],
                hours=r["hours"], start_date=r["start_date"], end_date=r["end_date"],
                gross=None if r["gross_cents"] is None else r["gross_cents"] / 100,
                net=None if r["net_cents"] is None else r["net_cents"] / 100,
                comment=r["comment"], job_title=r["job_title"],
                days_worked=r["days_worked"], documents=docs)


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

@app.get("/intermittence")
@login_required
def intermittence_page():
    return render_template("intermittence.html")

@app.get("/stats")
@login_required
def stats_page():
    return render_template("stats.html")

@app.get("/account")
@login_required
def account_page():
    return render_template("account.html")

@app.get("/healthz")
def healthz():
    get_db().execute("SELECT 1").fetchone()
    return jsonify(status="ok")


# ---------- API auth ----------
def finish_login(u):
    session.clear()
    session.permanent = True
    session["uid"] = u["id"]
    session["sv"] = u["session_version"]
    csrf_token()


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
    if mail_enabled():
        send_verification(cur.lastrowid, email)
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
    if u["totp_enabled"]:
        # mot de passe correct : on attend le second facteur, sans ouvrir de session
        csrf = session.get("csrf")      # conserve le jeton CSRF de la page de connexion
        session.clear()
        session["csrf"] = csrf or secrets.token_urlsafe(32)
        session["pending_uid"] = u["id"]
        session["pending_at"] = int(time.time())
        return jsonify(needs_2fa=True)
    finish_login(u)
    return jsonify(ok=True)


@app.post("/api/login/2fa")
def login_2fa():
    uid = session.get("pending_uid")
    if not uid or time.time() - session.get("pending_at", 0) > 300:
        session.pop("pending_uid", None)
        session.pop("pending_at", None)
        return err("Session expirée, recommence la connexion", 401)
    db = get_db()
    kind, bad = second_factor_ok(db, uid, (request.get_json(silent=True) or {}).get("code"))
    if bad:
        return bad
    u = db.execute("SELECT id, session_version FROM users WHERE id=?", (uid,)).fetchone()
    finish_login(u)
    return jsonify(ok=True, recovery_used=(kind == "recovery"))


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
        "INSERT INTO contracts(user_id, employer, mission, hours, start_date, end_date,"
        " gross_cents, net_cents, comment, job_title, days_worked)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
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
        "UPDATE contracts SET employer=?, mission=?, hours=?, start_date=?, end_date=?,"
        " gross_cents=?, net_cents=?, comment=?, job_title=?, days_worked=?"
        " WHERE id=? AND user_id=?",
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
    fct_date = da_iso = None
    r = current_right(db, uid)
    if r:
        fct, _, da, _ = right_dates(r)
        fct_date, da_iso = fct.isoformat(), da.isoformat()
        if fct + timedelta(days=1) > start:
            start, mode = fct + timedelta(days=1), "since_fct"
    t = period_totals(db, uid, start, today)
    return jsonify(hours=t["hours"], contracts=t["contracts"], target=HOURS_TARGET,
                   window_start=start.isoformat(), window_end=today.isoformat(),
                   mode=mode, fct_date=fct_date, anniversary_date=da_iso)

# ---------- API compte ----------
def bump_sessions(db, uid):
    db.execute("UPDATE users SET session_version = session_version + 1 WHERE id=?", (uid,))
    db.commit()
    session["sv"] = db.execute("SELECT session_version FROM users WHERE id=?", (uid,)).fetchone()[0]


@app.get("/api/account")
@login_required
def account_info():
    db, uid = get_db(), session["uid"]
    u = db.execute("SELECT email, created_at, email_verified, totp_enabled FROM users WHERE id=?",
                   (uid,)).fetchone()
    nc = db.execute("SELECT COUNT(*) FROM contracts WHERE user_id=?", (uid,)).fetchone()[0]
    nd = db.execute("SELECT COUNT(*) FROM documents WHERE user_id=?", (uid,)).fetchone()[0]
    left = db.execute("SELECT COUNT(*) FROM recovery_codes WHERE user_id=?", (uid,)).fetchone()[0]
    return jsonify(email=u["email"], created_at=u["created_at"], contracts=nc, documents=nd,
                   email_verified=bool(u["email_verified"]), totp_enabled=bool(u["totp_enabled"]),
                   recovery_left=left, mail_enabled=mail_enabled())


@app.post("/api/account/email")
@login_required
def change_email():
    d = request.get_json(silent=True) or {}
    db, uid = get_db(), session["uid"]
    email = str(d.get("email", "")).strip().lower()
    if not valid_email(email):
        return err("Email invalide")
    if hit(f"emailchg|{uid}", 5):
        return err("Trop de demandes, réessaie plus tard", 429)
    bad = check_password(uid, str(d.get("password", "")))
    if bad:
        return bad
    if not mail_enabled():
        try:
            db.execute("UPDATE users SET email=? WHERE id=?", (email, uid))
            db.commit()
        except sqlite3.IntegrityError:
            return err("Cette adresse n'est pas disponible", 409)
        return jsonify(ok=True, message="Adresse e-mail mise à jour.")
    taken = db.execute("SELECT 1 FROM users WHERE email=? AND id<>?", (email, uid)).fetchone()
    if not taken:       # même réponse dans tous les cas : pas de fuite sur les adresses existantes
        raw = make_token(db, uid, "email_change", email)
        send_mail(email, "507h – Confirme ta nouvelle adresse e-mail",
                  "Bonjour,\n\nConfirme ta nouvelle adresse e-mail pour 507h en ouvrant ce lien "
                  f"(valable 24 heures) :\n{base_url()}/verify?token={raw}\n\n"
                  "Si tu n'es pas à l'origine de cette demande, ignore ce message.\n")
    return jsonify(ok=True, message="Un lien de confirmation vient d'être envoyé à la nouvelle "
                                    "adresse. Ton adresse actuelle reste valable jusqu'à sa confirmation.")


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

@app.post("/api/account/import")
@login_required
def import_data():
    if (request.content_length or 0) > MAX_IMPORT_BYTES:
        return err("Fichier trop volumineux (2 Mo max)", 413)
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return err("Fichier JSON invalide")
    items = data.get("contracts", [])
    raw_rights = data.get("droits_are")
    if raw_rights is None and data.get("droit_are"):       # ancien format (0.4 à 0.6)
        raw_rights = [data["droit_are"]]
    raw_pay = data.get("virements", [])
    raw_limits = data.get("plafonds", [])
    for name, lst in (("contracts", items), ("droits_are", raw_rights or []),
                      ("virements", raw_pay), ("plafonds", raw_limits)):
        if not isinstance(lst, list):
            return err(f"Format inattendu : « {name} » doit être une liste")
    if len(items) > MAX_IMPORT_CONTRACTS or len(raw_pay) > MAX_IMPORT_CONTRACTS:
        return err(f"{MAX_IMPORT_CONTRACTS} éléments maximum par liste")

    errors, contracts, rights, pays, limits = [], [], [], [], []
    for label, src, dst, fn in (("Contrat", items, contracts, parse_contract),
                                ("Droit", raw_rights or [], rights, parse_rights),
                                ("Virement", raw_pay, pays, parse_payment),
                                ("Plafond", raw_limits, limits, parse_limit)):
        for i, it in enumerate(src, 1):
            try:
                dst.append(fn(it))
            except ValueError as e:
                errors.append(f"{label} n°{i} : {e}")
    if errors:
        return jsonify(error="Import refusé, rien n'a été modifié", details=errors[:10]), 400
    if not (contracts or rights or pays or limits):
        return err("Aucune donnée à importer dans ce fichier")

    db, uid = get_db(), session["uid"]
    seen_c = {(r["employer"].lower(), r["mission"], r["start_date"], r["end_date"], r["hours"])
              for r in db.execute("SELECT employer, mission, start_date, end_date, hours"
                                  " FROM contracts WHERE user_id=?", (uid,))}
    seen_r = {(r["annexe"], r["fct_date"], r["start_date"]) for r in db.execute(
        "SELECT annexe, fct_date, start_date FROM rights WHERE user_id=?", (uid,))}
    seen_p = {(r["paid_on"], r["month_covered"], r["amount_cents"]) for r in db.execute(
        "SELECT paid_on, month_covered, amount_cents FROM payments WHERE user_id=?", (uid,))}
    seen_l = {(r["label"].lower(), r["employer_match"].lower()) for r in db.execute(
        "SELECT label, employer_match FROM day_limits WHERE user_id=?", (uid,))}
    new_c, new_r, new_p, new_l, dup = [], [], [], [], 0
    for v in contracts:     # (employer, mission, hours, start, end, gross, net, comment, job, days)
        k = (v[0].lower(), v[1], v[3], v[4], v[2])
        if k in seen_c:
            dup += 1
        else:
            seen_c.add(k)
            new_c.append(v)
    for v in rights:        # (annexe, fct, start, da, aj, opening, note)
        k = (v[0], v[1], v[2])
        if k in seen_r:
            dup += 1
        else:
            seen_r.add(k)
            new_r.append(v)
    for v in pays:          # (paid_on, month, amount, days, note)
        k = (v[0], v[1], v[2])
        if k in seen_p:
            dup += 1
        else:
            seen_p.add(k)
            new_p.append(v)
    for v in limits:        # (label, match, max_days)
        k = (v[0].lower(), v[1].lower())
        if k in seen_l:
            dup += 1
        else:
            seen_l.add(k)
            new_l.append(v)
    counts = {
        "rights": (db.execute("SELECT COUNT(*) FROM rights WHERE user_id=?", (uid,)).fetchone()[0],
                   len(new_r), MAX_RIGHTS),
        "payments": (db.execute("SELECT COUNT(*) FROM payments WHERE user_id=?", (uid,)).fetchone()[0],
                     len(new_p), MAX_PAYMENTS),
        "limits": (db.execute("SELECT COUNT(*) FROM day_limits WHERE user_id=?", (uid,)).fetchone()[0],
                   len(new_l), MAX_LIMITS),
    }
    if any(have + new > cap for have, new, cap in counts.values()):
        return err("Limite de droits, de virements ou de plafonds dépassée")
    try:
        db.executemany(
            "INSERT INTO contracts(user_id, employer, mission, hours, start_date, end_date,"
            " gross_cents, net_cents, comment, job_title, days_worked)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            [(uid, *v) for v in new_c])
        db.executemany(RIGHT_INSERT, [(uid, *v) for v in new_r])
        db.executemany(PAYMENT_INSERT, [(uid, *v) for v in new_p])
        db.executemany("INSERT INTO day_limits(user_id, label, employer_match, max_days)"
                       " VALUES (?,?,?,?)", [(uid, *v) for v in new_l])
        db.commit()
    except sqlite3.Error:
        db.rollback()
        return err("Erreur lors de l'import, rien n'a été modifié", 500)
    return jsonify(added=len(new_c), rights=len(new_r), payments=len(new_p),
                   limits=len(new_l), duplicates=dup)

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
        z.writestr("507h-export.json", json.dumps(
            {"version": APP_VERSION, "email": u["email"], "created_at": u["created_at"],
             "droits_are": [{k: v for k, v in x.items() if k in (
                 "annexe", "opening_type", "fct_date", "start_date", "note")}
                 | {"anniversary_date": x["anniversary_input"], "aj_net": x["aj_net"]}
                 for x in rights_history(db, uid)],
             "virements": [{k: v for k, v in p.items() if k != "id"}
                           for p in payments_list(db, uid)],
             "plafonds": [{"label": r["label"], "employer_match": r["employer_match"],
                           "max_days": r["max_days"]}
                          for r in db.execute("SELECT * FROM day_limits WHERE user_id=? ORDER BY id",
                                              (uid,))],
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

# ---------- Intermittence ----------
HOURS_TARGET = 507
OPENING_TYPES = ("first", "renewal", "anticipated")
MAX_RIGHTS = 50
MAX_PAYMENTS = 1000
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

def add_year(d):
    try:
        return d.replace(year=d.year + 1)
    except ValueError:
        return d.replace(year=d.year + 1, day=28)


def period_totals(db, uid, start, end):
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


def right_dates(r):
    fct = date.fromisoformat(r["fct_date"])
    start = date.fromisoformat(r["start_date"])
    da_auto = add_year(fct)
    da = date.fromisoformat(r["anniversary_date"]) if r["anniversary_date"] else da_auto
    return fct, start, da, da_auto


def current_right(db, uid):
    return db.execute(
        "SELECT * FROM rights WHERE user_id=? ORDER BY start_date DESC, id DESC LIMIT 1",
        (uid,)).fetchone()


def cents(v):
    return None if v is None else v / 100


def rights_history(db, uid):
    rows = db.execute("SELECT * FROM rights WHERE user_id=? ORDER BY start_date ASC, id ASC",
                      (uid,)).fetchall()
    out = []
    for i, r in enumerate(rows):
        fct, start, da, _ = right_dates(r)
        end, early = da, False
        if i + 1 < len(rows):       # un droit ouvert plus tôt remplace celui-ci
            cut = date.fromisoformat(rows[i + 1]["start_date"]) - timedelta(days=1)
            if cut < da:
                end, early = cut, True
        tot = period_totals(db, uid, fct - timedelta(days=364), fct)
        out.append({
            "id": r["id"], "annexe": r["annexe"], "opening_type": r["opening_type"],
            "fct_date": fct.isoformat(), "start_date": start.isoformat(),
            "anniversary_date": da.isoformat(), "anniversary_input": r["anniversary_date"],
            "end_date": end.isoformat(), "ended_early": early,
            "aj_net": cents(r["aj_net_cents"]), "note": r["note"],
            "ref_hours": tot["hours"], "ref_gross": tot["gross"],
            "ref_missing_gross": tot["missing_gross"]})
    out.reverse()
    return out


def build_overview(db, uid):
    r = current_right(db, uid)
    if not r:
        return None
    today = date.today()
    fct, start, da, da_auto = right_dates(r)
    days_left = (da - today).days
    status = "expired" if days_left < 0 else "soon" if days_left <= 15 else "active"
    total_days = (da - start).days + 1
    win_start = fct + timedelta(days=1)
    total = period_totals(db, uid, win_start, da)
    done = period_totals(db, uid, win_start, min(da, today))
    needed = max(0.0, HOURS_TARGET - total["hours"])
    per_week = needed / (days_left / 7) if days_left > 0 and needed > 0 else None
    return {
        "right_id": r["id"], "annexe": r["annexe"], "opening_type": r["opening_type"],
        "fct_date": fct.isoformat(), "start_date": start.isoformat(),
        "anniversary_date": da.isoformat(), "anniversary_auto": da_auto.isoformat(),
        "anniversary_overridden": bool(r["anniversary_date"]),
        "exam_date": (da + timedelta(days=1)).isoformat(),
        "days_left": days_left, "status": status, "aj_net": cents(r["aj_net_cents"]),
        "elapsed_pct": max(0, min(100, round((today - start).days / max(1, total_days) * 100))),
        "total_days": total_days,
        "projection": {
            "window_start": win_start.isoformat(), "window_end": da.isoformat(),
            "hours_total": total["hours"], "hours_done": done["hours"],
            "hours_planned": round(total["hours"] - done["hours"], 2),
            "hours_needed": round(needed, 1), "per_week": per_week,
            "can_request_early": done["hours"] >= HOURS_TARGET and days_left > 0},
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
    opening = str(d.get("opening_type") or "renewal")
    if opening not in OPENING_TYPES:
        raise ValueError("Type d'ouverture invalide")
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
    note = str(d.get("note") or "").strip()
    if len(note) > 200:
        raise ValueError("Note : 200 caractères max")
    return (annexe, fct.isoformat(), start.isoformat(),
            da.isoformat() if da else None, ajn, opening, note)


RIGHT_INSERT = ("INSERT INTO rights(user_id, annexe, fct_date, start_date, anniversary_date,"
                " aj_net_cents, opening_type, note) VALUES (?,?,?,?,?,?,?,?)")


def parse_payment(d):
    if not isinstance(d, dict):
        raise ValueError("Données invalides")
    try:
        paid_on = date.fromisoformat(str(d.get("paid_on")))
    except ValueError:
        raise ValueError("Date du virement invalide")
    amount = to_cents(d.get("amount"))
    if amount is None or not (0 < amount <= 1_000_000):
        raise ValueError("Montant invalide (0 à 10 000 €)")
    month = str(d.get("month_covered") or "").strip()
    if not month:      # par défaut : le mois précédant le virement
        month = (paid_on.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")
    elif not MONTH_RE.match(month):
        raise ValueError("Mois concerné invalide (format AAAA-MM)")
    days = d.get("days_paid")
    if days in (None, ""):
        days = None
    else:
        try:
            days = int(days)
        except (TypeError, ValueError):
            raise ValueError("Nombre de jours invalide")
        if not 0 <= days <= 31:
            raise ValueError("Jours indemnisés : 0 à 31")
    note = str(d.get("note") or "").strip()
    if len(note) > 200:
        raise ValueError("Note : 200 caractères max")
    return (paid_on.isoformat(), month, amount, days, note)


PAYMENT_INSERT = ("INSERT INTO payments(user_id, paid_on, month_covered, amount_cents,"
                  " days_paid, note) VALUES (?,?,?,?,?,?)")


def payments_list(db, uid):
    return [{"id": r["id"], "paid_on": r["paid_on"], "month_covered": r["month_covered"],
             "amount": r["amount_cents"] / 100, "days_paid": r["days_paid"], "note": r["note"]}
            for r in db.execute("SELECT * FROM payments WHERE user_id=?"
                                " ORDER BY paid_on DESC, id DESC", (uid,))]


def payments_totals(db, uid, right_start):
    today = date.today()
    q = "SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE user_id=? AND paid_on > ? AND paid_on <= ?"
    last12 = db.execute(q, (uid, (today - timedelta(days=365)).isoformat(),
                            today.isoformat())).fetchone()[0]
    since = None
    if right_start:
        since = db.execute(
            "SELECT COALESCE(SUM(amount_cents),0) FROM payments WHERE user_id=? AND paid_on >= ?",
            (uid, right_start)).fetchone()[0] / 100
    return {"last12": last12 / 100, "since_right": since}


@app.get("/api/intermittence")
@login_required
def get_intermittence():
    db, uid = get_db(), session["uid"]
    ov = build_overview(db, uid)
    return jsonify(overview=ov, rights=rights_history(db, uid),
                   payments=payments_list(db, uid),
                   totals=payments_totals(db, uid, ov["start_date"] if ov else None))


@app.post("/api/rights")
@login_required
def add_right():
    try:
        vals = parse_rights(request.get_json(silent=True))
    except ValueError as e:
        return err(str(e))
    db, uid = get_db(), session["uid"]
    if db.execute("SELECT COUNT(*) FROM rights WHERE user_id=?", (uid,)).fetchone()[0] >= MAX_RIGHTS:
        return err(f"{MAX_RIGHTS} droits maximum")
    cur = db.execute(RIGHT_INSERT, (uid, *vals))
    db.commit()
    return jsonify(id=cur.lastrowid), 201


@app.put("/api/rights/<int:rid>")
@login_required
def edit_right(rid):
    try:
        vals = parse_rights(request.get_json(silent=True))
    except ValueError as e:
        return err(str(e))
    db = get_db()
    cur = db.execute(
        "UPDATE rights SET annexe=?, fct_date=?, start_date=?, anniversary_date=?,"
        " aj_net_cents=?, opening_type=?, note=? WHERE id=? AND user_id=?",
        (*vals, rid, session["uid"]))
    db.commit()
    return jsonify(ok=True) if cur.rowcount else err("Introuvable", 404)


@app.delete("/api/rights/<int:rid>")
@login_required
def delete_right(rid):
    db = get_db()
    cur = db.execute("DELETE FROM rights WHERE id=? AND user_id=?", (rid, session["uid"]))
    db.commit()
    return jsonify(ok=True) if cur.rowcount else err("Introuvable", 404)


@app.post("/api/payments")
@login_required
def add_payment():
    try:
        vals = parse_payment(request.get_json(silent=True))
    except ValueError as e:
        return err(str(e))
    db, uid = get_db(), session["uid"]
    if db.execute("SELECT COUNT(*) FROM payments WHERE user_id=?", (uid,)).fetchone()[0] >= MAX_PAYMENTS:
        return err(f"{MAX_PAYMENTS} virements maximum")
    cur = db.execute(PAYMENT_INSERT, (uid, *vals))
    db.commit()
    return jsonify(id=cur.lastrowid), 201


@app.put("/api/payments/<int:pid>")
@login_required
def edit_payment(pid):
    try:
        vals = parse_payment(request.get_json(silent=True))
    except ValueError as e:
        return err(str(e))
    db = get_db()
    cur = db.execute(
        "UPDATE payments SET paid_on=?, month_covered=?, amount_cents=?, days_paid=?, note=?"
        " WHERE id=? AND user_id=?", (*vals, pid, session["uid"]))
    db.commit()
    return jsonify(ok=True) if cur.rowcount else err("Introuvable", 404)


@app.delete("/api/payments/<int:pid>")
@login_required
def delete_payment(pid):
    db = get_db()
    cur = db.execute("DELETE FROM payments WHERE id=? AND user_id=?", (pid, session["uid"]))
    db.commit()
    return jsonify(ok=True) if cur.rowcount else err("Introuvable", 404)

# ---------- Statistiques ----------
PERIODS = {"12m": "12 derniers mois", "year": "Année en cours", "prev_year": "Année précédente",
               "right": "Droit en cours", "all": "Depuis le début"}


def add_months(d, n):
    m = d.year * 12 + d.month - 1 + n
    return date(m // 12, m % 12 + 1, 1)


def month_list(first, last):
    out, d = [], first
    while d <= last:
        out.append(d.strftime("%Y-%m"))
        d = add_months(d, 1)
    return out


def spread(s, e, value, since=None, until=None):
    """Répartit une valeur au prorata des jours du contrat, par mois."""
    total = (e - s).days + 1
    out = defaultdict(float)
    d = s
    while d <= e:
        if until is not None and d > until:
            break
        nxt = add_months(d, 1)
        a = max(d, since) if since else d
        b = min(e, nxt - timedelta(days=1))
        if until is not None:
            b = min(b, until)
        if b >= a:
            out[d.strftime("%Y-%m")] += value * ((b - a).days + 1) / total
        d = nxt
    return out


def summarize(items):
    if not items:
        return None
    best = max(items, key=lambda x: x[1])
    vals = [v for _, v in items]
    return {"best_month": best[0], "best": round(best[1], 2),
            "mean": round(statistics.fmean(vals), 2),
            "median": round(statistics.median(vals), 2), "months": len(vals)}



def period_bounds(db, uid, key, today):
    """Retourne (premier mois, dernier mois, jour de départ exact, jour de départ des virements)."""
    cur = today.replace(day=1)
    if key == "year":
        return date(today.year, 1, 1), cur, None, None
    if key == "prev_year":
        return date(today.year - 1, 1, 1), date(today.year - 1, 12, 1), None, None
    if key == "right":
        r = current_right(db, uid)
        if r:
            fct, start, _, _ = right_dates(r)
            since = fct + timedelta(days=1)    # même base que la page Intermittence
            return min(since.replace(day=1), cur), cur, since, start
    if key == "all":
        c = db.execute("SELECT MIN(start_date) FROM contracts WHERE user_id=?", (uid,)).fetchone()[0]
        p = db.execute("SELECT MIN(month_covered) FROM payments WHERE user_id=?", (uid,)).fetchone()[0]
        cands = []
        if c:
            cands.append(date.fromisoformat(c).replace(day=1))
        if p:
            cands.append(date.fromisoformat(p + "-01"))
        if cands:
            return min(min(cands), cur), cur, None, None
    return add_months(cur, -11), cur, None, None

def bucket(store, key, name):
    return store.setdefault(key, {"name": name, "hours": 0.0, "net": 0.0, "contracts": 0})


def ranked(store):
    return sorted(({**v, "hours": round(v["hours"], 1), "net": round(v["net"], 2)}
                   for v in store.values()), key=lambda v: -v["hours"])

def build_stats(db, uid, key):
    if key not in PERIODS:
        key = "12m"
    today = date.today()
    first, last, since, pay_since = period_bounds(db, uid, key, today)
    lower = since or first
    months = month_list(first, last)
    mset, cur_key, first_key = set(months), today.strftime("%Y-%m"), first.strftime("%Y-%m")
    range_end = add_months(last, 1) - timedelta(days=1)
    partial_first = since is not None and since.day != 1

    hours, salary, are = defaultdict(float), defaultdict(float), defaultdict(float)
    emp, jobs, no_net = {}, {}, 0
    rows = db.execute(
        "SELECT employer, job_title, hours, start_date, end_date, net_cents FROM contracts"
        " WHERE user_id=? AND end_date >= ? AND start_date <= ?",
        (uid, lower.isoformat(), range_end.isoformat()))
    for r in rows:
        s, e = date.fromisoformat(r["start_date"]), date.fromisoformat(r["end_date"])
        h_in = {m: v for m, v in spread(s, e, r["hours"], since, today).items() if m in mset}
        if not h_in:
            continue
        job = " ".join((r["job_title"] or "").split())
        targets = (
            bucket(emp, " ".join(r["employer"].lower().split()), r["employer"]),
            bucket(jobs, job.lower(), job or "Non renseigné"),
        )
        for t in targets:
            t["contracts"] += 1
        for m, v in h_in.items():
            hours[m] += v
            for t in targets:
                t["hours"] += v
        if r["net_cents"] is None:
            no_net += 1
        else:
            for m, v in spread(s, e, r["net_cents"] / 100, since, today).items():
                if m in mset:
                    salary[m] += v
                    for t in targets:
                        t["net"] += v
    pay_floor = pay_since.isoformat() if pay_since else None
    for p in db.execute("SELECT month_covered, paid_on, amount_cents FROM payments WHERE user_id=?", (uid,)):
        if p["month_covered"] in mset and (pay_floor is None or p["paid_on"] >= pay_floor):
            are[p["month_covered"]] += p["amount_cents"] / 100

    series = [{
        "month": m, "hours": round(hours[m], 1), "salary": round(salary[m], 2),
        "are": round(are[m], 2), "total": round(salary[m] + are[m], 2),
        "complete": m < cur_key and not (partial_first and m == first_key),
    } for m in months]
    done = [x for x in series if x["complete"]]
    end_day = min(today, range_end)
    days = (end_day - lower).days + 1
    total_hours = sum(x["hours"] for x in series)

    hist = rights_history(db, uid)
    events = {
        "contracts": [
            {"s": r["start_date"], "e": r["end_date"], "h": r["hours"],
             "emp": r["employer"], "mission": r["mission"]}
            for r in db.execute(
                "SELECT employer, mission, hours, start_date, end_date"
                " FROM contracts WHERE user_id=?", (uid,))],
        "payments": [
            {"d": p["paid_on"], "a": p["amount"], "m": p["month_covered"]}
            for p in payments_list(db, uid)],
        "rights": [],
    }
    for r in hist:
        events["rights"] += [
            {"kind": "fct", "d": r["fct_date"]},
            {"kind": "start", "d": r["start_date"]},
            {"kind": "anniv", "d": r["anniversary_date"], "early": r["ended_early"]}]
        if r["ended_early"]:
            events["rights"].append({"kind": "end", "d": r["end_date"]})

    return {
        "period": {"key": key, "label": PERIODS[key],
                   "first": lower.isoformat(), "last": end_day.isoformat()},
        "series": series,
        "hours_total": round(total_hours, 1),
        "hours_per_week": round(total_hours / (days / 7), 1) if days > 0 else None,
        "hours_stats": summarize([(x["month"], x["hours"]) for x in done]),
        "income": {k: summarize([(x["month"], x[k]) for x in done])
                   for k in ("salary", "are", "total")},
        "employers": ranked(emp), "jobs": ranked(jobs),
        "no_net": no_net, "events": events,
    }


@app.get("/api/stats")
@login_required
def get_stats():
    return jsonify(build_stats(get_db(), session["uid"], request.args.get("period", "12m")))

# ---------- Pages publiques liées aux e-mails ----------
@app.context_processor
def inject_mail_state():
    unverified = False
    uid = session.get("uid")
    if uid and mail_enabled():
        r = get_db().execute("SELECT email_verified FROM users WHERE id=?", (uid,)).fetchone()
        unverified = bool(r) and not r["email_verified"]
    return {"email_unverified": unverified, "mail_on": mail_enabled()}


@app.get("/forgot")
def forgot_page():
    return render_template("forgot.html")


@app.get("/reset")
def reset_page():
    return render_template("reset.html")


@app.get("/verify")
def verify_page():
    return render_template("confirm.html")


# ---------- Vérification de l'adresse e-mail ----------
@app.post("/api/email/send-verification")
@login_required
def resend_verification():
    if not mail_enabled():
        return err("L'envoi d'e-mails n'est pas configuré sur ce serveur", 503)
    db, uid = get_db(), session["uid"]
    u = db.execute("SELECT email, email_verified FROM users WHERE id=?", (uid,)).fetchone()
    if u["email_verified"]:
        return jsonify(ok=True, message="Adresse déjà vérifiée.")
    if hit(f"verify|{uid}", 3):
        return err("Trop de demandes, réessaie dans 15 minutes", 429)
    send_verification(uid, u["email"])
    return jsonify(ok=True, message="Lien envoyé. Pense à vérifier tes courriers indésirables.")


@app.post("/api/email/confirm")
def confirm_email():
    db = get_db()
    row = consume_token(db, str((request.get_json(silent=True) or {}).get("token", "")),
                        ("verify", "email_change"))
    if not row:
        return err("Lien invalide ou expiré")
    try:
        if row["purpose"] == "verify":
            db.execute("UPDATE users SET email_verified=1 WHERE id=?", (row["user_id"],))
        else:
            db.execute("UPDATE users SET email=?, email_verified=1 WHERE id=?",
                       (row["new_email"], row["user_id"]))
            db.execute("DELETE FROM email_tokens WHERE user_id=? AND purpose='verify'",
                       (row["user_id"],))
        db.commit()
    except sqlite3.IntegrityError:
        return err("Cette adresse est déjà utilisée par un autre compte", 409)
    return jsonify(ok=True, kind=row["purpose"])


# ---------- Mot de passe oublié ----------
@app.post("/api/password/forgot")
def forgot_password():
    if not mail_enabled():
        return err("L'envoi d'e-mails n'est pas configuré sur ce serveur", 503)
    email = str((request.get_json(silent=True) or {}).get("email", "")).strip().lower()
    if hit(f"forgot-ip|{request.remote_addr}", 10) or hit(f"forgot|{email}", 3):
        return err("Trop de demandes, réessaie dans 15 minutes", 429)
    if valid_email(email):
        db = get_db()
        u = db.execute("SELECT id FROM users WHERE email=? AND email_verified=1", (email,)).fetchone()
        if u:
            raw = make_token(db, u["id"], "reset")
            send_mail(email, "507h – Réinitialisation du mot de passe",
                      "Bonjour,\n\nPour choisir un nouveau mot de passe, ouvre ce lien "
                      f"(valable 1 heure) :\n{base_url()}/reset?token={raw}\n\n"
                      "Si tu n'es pas à l'origine de cette demande, ignore ce message : "
                      "ton mot de passe ne changera pas.\n")
    return jsonify(ok=True, message="Si un compte vérifié existe pour cette adresse, "
                                    "un e-mail vient d'être envoyé.")


@app.post("/api/password/reset")
def reset_password():
    d = request.get_json(silent=True) or {}
    pwd = str(d.get("password", ""))
    if not (12 <= len(pwd) <= 200):
        return err("Mot de passe : 12 caractères minimum")
    if pwd != str(d.get("password_confirm", "")):
        return err("Les mots de passe ne correspondent pas")
    db = get_db()
    row = consume_token(db, str(d.get("token", "")), ("reset",))
    if not row:
        return err("Lien invalide ou expiré")
    db.execute("UPDATE users SET password_hash=?, session_version=session_version+1 WHERE id=?",
               (generate_password_hash(pwd), row["user_id"]))
    db.commit()
    session.clear()
    return jsonify(ok=True)


# ---------- Double authentification ----------
@app.post("/api/2fa/setup")
@login_required
def twofa_setup():
    db, uid = get_db(), session["uid"]
    bad = check_password(uid, str((request.get_json(silent=True) or {}).get("password", "")))
    if bad:
        return bad
    if db.execute("SELECT totp_enabled FROM users WHERE id=?", (uid,)).fetchone()[0]:
        return err("La double authentification est déjà activée")
    secret = base64.b32encode(secrets.token_bytes(20)).decode()
    db.execute("UPDATE users SET totp_secret=?, totp_enabled=0, totp_last_step=0 WHERE id=?",
               (FERNET.encrypt(secret.encode()).decode(), uid))
    db.commit()
    return jsonify(secret=secret)


@app.get("/api/2fa/qr.svg")
@login_required
def twofa_qr():
    u = get_db().execute("SELECT email, totp_secret, totp_enabled FROM users WHERE id=?",
                         (session["uid"],)).fetchone()
    if not u or not u["totp_secret"] or u["totp_enabled"]:
        abort(404)
    secret = FERNET.decrypt(u["totp_secret"].encode()).decode()
    label = quote(f"507h:{u['email']}", safe="@:")
    uri = f"otpauth://totp/{label}?secret={secret}&issuer=507h&algorithm=SHA1&digits=6&period=30"
    buf = io.BytesIO()
    segno.make(uri, error="m").save(buf, kind="svg", scale=6, border=2,
                                    dark="#000000", light="#ffffff")
    return Response(buf.getvalue(), mimetype="image/svg+xml")


@app.post("/api/2fa/enable")
@login_required
def twofa_enable():
    db, uid = get_db(), session["uid"]
    if hit(f"2fa-setup|{uid}", 10):
        return err("Trop de tentatives, réessaie dans 15 minutes", 429)
    u = db.execute("SELECT totp_secret, totp_enabled FROM users WHERE id=?", (uid,)).fetchone()
    if not u["totp_secret"] or u["totp_enabled"]:
        return err("Lance d'abord la configuration")
    secret = FERNET.decrypt(u["totp_secret"].encode()).decode()
    step = check_totp(secret, (request.get_json(silent=True) or {}).get("code"), 0)
    if not step:
        return err("Code incorrect")
    codes = new_recovery_codes(db, uid)
    db.execute("UPDATE users SET totp_enabled=1, totp_last_step=? WHERE id=?", (step, uid))
    db.commit()
    bump_sessions(db, uid)      # déconnecte les autres appareils, garde celui-ci
    return jsonify(recovery_codes=codes)


@app.post("/api/2fa/disable")
@login_required
def twofa_disable():
    db, uid = get_db(), session["uid"]
    d = request.get_json(silent=True) or {}
    bad = check_password(uid, str(d.get("password", "")))
    if bad:
        return bad
    _, bad = second_factor_ok(db, uid, d.get("code"))
    if bad:
        return bad
    db.execute("UPDATE users SET totp_secret=NULL, totp_enabled=0, totp_last_step=0 WHERE id=?", (uid,))
    db.execute("DELETE FROM recovery_codes WHERE user_id=?", (uid,))
    db.commit()
    return jsonify(ok=True)


@app.post("/api/2fa/recovery")
@login_required
def twofa_recovery():
    db, uid = get_db(), session["uid"]
    d = request.get_json(silent=True) or {}
    bad = check_password(uid, str(d.get("password", "")))
    if bad:
        return bad
    _, bad = second_factor_ok(db, uid, d.get("code"))
    if bad:
        return bad
    codes = new_recovery_codes(db, uid)
    db.commit()
    return jsonify(recovery_codes=codes)

# ---------- Plafonds annuels de jours travaillés ----------
HOURS_PER_DAY = 8
MAX_LIMITS = 10


def fold_text(s):
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(ch for ch in s if not unicodedata.combining(ch)).lower().strip()


def contract_days(hours, days_worked):
    """Jours d'un contrat : valeur saisie, sinon heures / 8. Retourne (jours, estimé)."""
    if days_worked is not None:
        return float(days_worked), False
    return hours / HOURS_PER_DAY, True


def limit_usage(db, uid, rule, year, today):
    y0, y1 = date(year, 1, 1), date(year, 12, 31)
    match = fold_text(rule["employer_match"])
    done = planned = 0.0
    n = estimated = 0
    rows = db.execute(
        "SELECT employer, hours, start_date, end_date, days_worked FROM contracts"
        " WHERE user_id=? AND end_date >= ? AND start_date <= ?",
        (uid, y0.isoformat(), y1.isoformat()))
    for r in rows:
        if match not in fold_text(r["employer"]):
            continue
        s, e = date.fromisoformat(r["start_date"]), date.fromisoformat(r["end_date"])
        days, est = contract_days(r["hours"], r["days_worked"])
        span = (e - s).days + 1
        lo, hi = max(s, y0), min(e, y1)
        in_year = (hi - lo).days + 1
        cut = min(hi, today)
        past = (cut - lo).days + 1 if cut >= lo else 0
        done += days * past / span          # répartition au prorata des jours du contrat
        planned += days * (in_year - past) / span
        n += 1
        estimated += est
    total = done + planned
    remaining = rule["max_days"] - total
    per_week = None
    if year == today.year and remaining > 0:
        days_left = (y1 - today).days
        if days_left > 0:
            per_week = round(remaining / (days_left / 7), 1)
    return {
        "id": rule["id"], "label": rule["label"], "employer_match": rule["employer_match"],
        "max_days": rule["max_days"], "done": round(done, 1), "planned": round(planned, 1),
        "total": round(total, 1), "remaining": round(remaining, 1),
        "over": round(total, 1) > rule["max_days"], "per_week": per_week,
        "estimated": estimated, "contracts": n,
    }


def parse_limit(d):
    if not isinstance(d, dict):
        raise ValueError("Données invalides")
    label = " ".join(str(d.get("label", "")).split())
    match = " ".join(str(d.get("employer_match", "")).split())
    if not label or len(label) > 60:
        raise ValueError("Nom requis (60 caractères max)")
    if not match or len(match) > 80:
        raise ValueError("Texte de l'employeur requis (80 caractères max)")
    try:
        max_days = int(d.get("max_days") or 80)
    except (TypeError, ValueError):
        raise ValueError("Nombre de jours invalide")
    if not 1 <= max_days <= 366:
        raise ValueError("Jours maximum : de 1 à 366")
    return (label, match, max_days)


@app.get("/api/limits")
@login_required
def list_limits():
    db, uid = get_db(), session["uid"]
    today = date.today()
    try:
        year = int(request.args.get("year", today.year))
    except ValueError:
        year = today.year
    year = min(max(year, 2000), 2100)
    rules = db.execute("SELECT * FROM day_limits WHERE user_id=? ORDER BY id", (uid,)).fetchall()
    return jsonify(year=year, rules=[limit_usage(db, uid, r, year, today) for r in rules])


@app.post("/api/limits")
@login_required
def add_limit():
    try:
        vals = parse_limit(request.get_json(silent=True))
    except ValueError as e:
        return err(str(e))
    db, uid = get_db(), session["uid"]
    if db.execute("SELECT COUNT(*) FROM day_limits WHERE user_id=?", (uid,)).fetchone()[0] >= MAX_LIMITS:
        return err(f"{MAX_LIMITS} plafonds maximum")
    cur = db.execute("INSERT INTO day_limits(user_id, label, employer_match, max_days)"
                     " VALUES (?,?,?,?)", (uid, *vals))
    db.commit()
    return jsonify(id=cur.lastrowid), 201


@app.put("/api/limits/<int:lid>")
@login_required
def edit_limit(lid):
    try:
        vals = parse_limit(request.get_json(silent=True))
    except ValueError as e:
        return err(str(e))
    db = get_db()
    cur = db.execute("UPDATE day_limits SET label=?, employer_match=?, max_days=?"
                     " WHERE id=? AND user_id=?", (*vals, lid, session["uid"]))
    db.commit()
    return jsonify(ok=True) if cur.rowcount else err("Introuvable", 404)


@app.delete("/api/limits/<int:lid>")
@login_required
def delete_limit(lid):
    db = get_db()
    cur = db.execute("DELETE FROM day_limits WHERE id=? AND user_id=?", (lid, session["uid"]))
    db.commit()
    return jsonify(ok=True) if cur.rowcount else err("Introuvable", 404)

if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=os.environ.get("DEV") == "1", port=5007)