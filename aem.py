"""Lecture d'une AEM (attestation employeur mensuelle, formulaire DAJ 110) et rattachement à un contrat.

Trois usages :
- importé par main.py : `filename_hint`, `partial_reason` et `match_contracts` (fonctions pures, sans dépendance lourde),
  `match_contracts` servant aussi aux bulletins de paie (bulletin.py) ;
- importé par bulletin.py : `run` et les petites fonctions de lecture ;
- lancé comme script (`python aem.py < fichier.pdf`) : lit un PDF sur l'entrée standard et écrit un JSON sur la
  sortie standard. main.py l'exécute ainsi dans un sous-processus à durée et mémoire limitées, car un PDF
  est un fichier non fiable.

Seuls les champs utiles au suivi sont lus (employeur, dates, heures, cachets, jours, brut, emploi).
Le formulaire contient aussi des données personnelles (identité, NIR, adresse) qui ne sont jamais extraites.
"""
import io
import json
import re
import sys
import unicodedata
from datetime import date

MAX_PAGES = 3
MAX_PDF = 10 * 1024 * 1024
CATEGORY_LABELS = ("Cadre", "Réalisateur", "Artiste", "Technicien", "Ouvrier")
TYPE_LABELS = {"INITIALE": "initiale", "COMPLÉMENTAIRE": "complémentaire", "RECTIFICATIVE": "rectificative"}


def fold(s):
    """Minuscules sans accents, pour comparer des textes."""
    s = unicodedata.normalize("NFD", str(s or ""))
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip()


# ---------------------------------------------------------------------------
# Lecture du PDF
# ---------------------------------------------------------------------------
def _find(words, text):
    return next((w for w in words if w["text"] == text), None)


def _find_ending(words, suffix):
    return next((w for w in words if fold(w["text"]).endswith(suffix)), None)


def _row(words, top, lo, hi):
    """Mots dont le haut est dans [top + lo, top + hi], de gauche à droite."""
    return sorted((w for w in words if top + lo <= w["top"] <= top + hi), key=lambda w: w["x0"])


def _center(w):
    return (w["x0"] + w["x1"]) / 2


def _number(text):
    try:
        return float(text.replace(",", "."))
    except ValueError:
        return None


def _date(tokens):
    """['02', '10', '2026'] -> '2026-10-02'."""
    if len(tokens) != 3:
        return None
    try:
        day, month, year = (int(t) for t in tokens)
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def _checked(labels, marks):
    """Libellés dont la case est cochée : la case suit son libellé, le « X » est juste à sa droite."""
    found = []
    for m in marks:
        owners = [l for l in labels if l["x1"] <= m["x0"] + 3 and m["x0"] - l["x1"] <= 15]
        if owners:
            found.append(max(owners, key=lambda l: l["x1"])["text"])
    return found

def contract_number(numbers):
    """Le n° de contrat parmi les nombres lus dans l'en-tête : 6 chiffres (000125), alors que le matricule en a 8."""
    return next((n for n in numbers if len(n) == 6), None)


def resolve_contract_number(doc, wanted):
    """Retient le n° de contrat du nom de fichier (`wanted`) s'il figure parmi les nombres lus sur la page, ou si
    rien n'a été lu ; sinon celui que la lecture du PDF a trouvé. Retire la liste des nombres lus."""
    numbers = doc.pop("contract_numbers", [])
    if wanted and (not doc.get("contract_number") or wanted in numbers):
        doc["contract_number"] = wanted
    return doc

def parse_words(words):
    """Extrait les champs utiles d'une AEM à partir des mots (avec coordonnées) de sa première page."""
    text = fold(" ".join(w["text"] for w in words))
    if "bulletin de paie" in text:
        raise ValueError("Ce PDF est un bulletin de paie : utilise « Importer un bulletin de paie ».")
    if "annexes 8 et 10" not in text or "attestation" not in text:
        raise ValueError("Ce PDF ne ressemble pas à une attestation employeur mensuelle (AEM).")

    out, warnings = {}, []

    # N° de contrat : en-tête du formulaire de France Télévisions (deuxième valeur de la première ligne)
    head = sorted((w for w in words if w["top"] < 12), key=lambda w: w["x0"])
    if len(head) >= 4:
        numbers = [w["text"] for w in head if re.fullmatch(r"\d{4,10}", w["text"])]
        out["contract_numbers"] = numbers
        out["contract_number"] = contract_number(numbers)

    # Type d'attestation (initiale, complémentaire, rectificative)
    a = _find(words, "COMPLÉMENTAIRE")
    if a:
        row = [w for w in _row(words, a["top"], -8, 4) if w["x0"] < 300]
        labels = [w for w in row if w["text"] in TYPE_LABELS]
        marks = [w for w in row if w["text"] == "X"]
        kinds = _checked(labels, marks)
        if kinds:
            out["type"] = TYPE_LABELS[kinds[0]]

    # Mois de paie : chiffres isolés en cases à droite de « MOIS » (« 1 0 20 2 6 » -> 10 / 2026)
    a = _find(words, "MOIS")
    if a:
        digits = "".join(w["text"] for w in _row(words, a["top"], -8, 8)
                         if w["text"].isdigit() and a["x1"] < w["x0"] < a["x1"] + 100)
        if len(digits) == 6 and 1 <= int(digits[:2]) <= 12:
            out["month"] = f"{digits[2:]}-{digits[:2]}"

    # Employeur
    a = _find(words, "Raison")
    if a:
        name = [w["text"] for w in _row(words, a["top"], -3, 3)
                if w["x0"] > a["x1"] and w["x0"] < 380 and w["text"] != "Sociale"]
        out["employer"] = " ".join(name) or None

    # Emploi occupé et annexe (déduite de la catégorie cochée)
    a = _find(words, "occupé")
    if a:
        job = [w["text"] for w in _row(words, a["top"], -3, 3) if a["x1"] < w["x0"] < 330]
        out["job_title"] = " ".join(job) or None
    a = _find(words, "Technicien")
    if a:
        row = _row(words, a["top"], -5, 5)
        labels = [w for w in row if w["text"] in CATEGORY_LABELS]
        found = _checked(labels, [w for w in row if w["text"] == "X"])
        if "Artiste" in found:
            out["annexe"] = 10
        elif {"Technicien", "Ouvrier", "Réalisateur"} & set(found):
            out["annexe"] = 8

    # Dates du contrat : début à gauche, fin à droite, trois cases jour / mois / année
    a = _find_ending(words, "embauche")         # « d'embauche » (apostrophe droite ou typographique)
    if a:
        row = [w for w in _row(words, a["top"], -10, 3) if re.fullmatch(r"\d{1,4}", w["text"])]
        out["start_date"] = _date([w["text"] for w in row if w["x0"] < 300])
        out["end_date"] = _date([w["text"] for w in row if 300 <= w["x0"] < 570])

    # Heures, cachets (isolés / groupés) et jours travaillés : valeur sous le libellé le plus proche
    anchors = {k: _find(words, t) for k, t in (("hours", "effectuées"), ("isolated", "isolés"),
                                              ("grouped", "groupés"), ("days", "travaillés"))}
    if all(anchors.values()):
        values = [w for w in _row(words, anchors["days"]["top"], 6, 20) if re.fullmatch(r"\d+([.,]\d+)?", w["text"])]
        got = {}
        for w in values:
            key = min(anchors, key=lambda k: abs(_center(anchors[k]) - _center(w)))
            if key in got:
                warnings.append("Plusieurs valeurs lues dans la même colonne (heures, cachets ou jours).")
            got.setdefault(key, _number(w["text"]))
        out["hours"] = got.get("hours")
        out["cachets"] = int((got.get("isolated") or 0) + (got.get("grouped") or 0))
        out["days_worked"] = got.get("days")

    # Salaire brut : première valeur sous « SALAIRES BRUTS »
    a = _find(words, "soumis")
    if a:
        values = [w for w in _row(words, a["top"], 6, 20) if re.fullmatch(r"\d+,\d{2}", w["text"])]
        out["gross"] = _number(values[0]["text"]) if values else None

    has_quantity = any(out.get(k) is not None for k in ("hours", "days_worked")) or bool(out.get("cachets"))
    if not (out.get("employer") and out.get("start_date") and has_quantity):
        raise ValueError("Impossible de lire cette AEM : mise en page inconnue.")
    if out.get("start_date") and out.get("end_date") and out["end_date"] < out["start_date"]:
        warnings.append("La date de fin précède la date de début : vérifie le document.")
    if out.get("type") in ("complémentaire", "rectificative"):
        warnings.append(f"AEM {out['type']} : elle complète ou corrige une attestation précédente.")
    for key, label in (("gross", "salaire brut"), ("hours", "heures")):
        if out.get(key) is None:
            warnings.append(f"{label[0].upper()}{label[1:]} non lu(e) : à renseigner à la main.")
    out["warnings"] = warnings
    return out


def read_words(data):
    import pdfplumber       # import tardif : main.py n'a pas besoin de la bibliothèque

    with pdfplumber.open(io.BytesIO(data)) as pdf:
        if not pdf.pages:
            raise ValueError("Ce PDF est vide.")
        if len(pdf.pages) > MAX_PAGES:
            raise ValueError("Ce PDF a trop de pages pour être un document de ce type.")
        return pdf.pages[0].extract_words(x_tolerance=2, y_tolerance=2)


def filename_hint(name):
    """Indices tirés du nom de fichier de France Télévisions : AEM-CONTRAT-000129-DU-02-10-2026-AU-02-10-2026-1.pdf."""
    m = re.search(r"AEM-CONTRAT-(\d+)-DU-(\d{2})-(\d{2})-(\d{4})-AU-(\d{2})-(\d{2})-(\d{4})", name or "", re.I)
    if not m:
        return {}
    n, d1, m1, y1, d2, m2, y2 = m.groups()
    return {"contract_number": n, "start_date": _date([d1, m1, y1]), "end_date": _date([d2, m2, y2])}


# ---------------------------------------------------------------------------
# Rattachement à un contrat existant (AEM ou bulletin de paie)
# ---------------------------------------------------------------------------
def partial_reason(doc):
    """Pourquoi ce document ne couvre qu'une partie du contrat, ou None s'il le couvre en entier.

    Le « mois » d'une AEM est celui du règlement de la paie, pas celui du travail : un contrat de septembre
    payé en octobre porte une AEM d'octobre. Ce qui compte, c'est que le document couvre tout le contrat.
    Un bulletin de paie, lui, est établi par contrat : il le couvre toujours en entier.
    """
    if doc.get("document") == "bulletin":
        return None
    if doc.get("type") in ("complémentaire", "rectificative"):
        return f"AEM {doc['type']} : elle ne couvre qu'une partie du contrat ou en corrige une autre."
    if not doc.get("end_date"):
        return "Contrat en cours : cette AEM ne couvre que la paie de son mois."
    if doc.get("type") is None and (doc.get("start_date") or "")[:7] != doc["end_date"][:7]:
        return "Contrat sur plusieurs mois : cette AEM ne couvre peut-être qu'une partie du contrat."
    return None


def _same_employer(a, b):
    a, b = fold(a), fold(b)
    return bool(a) and bool(b) and (a == b or a in b or b in a)


def _number_found(number, contract):
    """Le n° de contrat figure-t-il, comme nombre entier, dans le commentaire ou la mission ?"""
    wanted = (number or "").lstrip("0")
    if not wanted:
        return False
    runs = re.findall(r"\d+", f"{contract.get('comment') or ''} {contract.get('mission') or ''}")
    return any(r.lstrip("0") == wanted for r in runs if len(r) >= 3)


def _eur(value):
    return f"{value:.2f}".replace(".", ",") + " €"


def _fr_date(iso):
    return f"{iso[8:10]}/{iso[5:7]}/{iso[:4]}" if iso else "?"


def match_contracts(aem, contracts):
    """Classe les contrats de l'application susceptibles de correspondre à une AEM ou à un bulletin de paie.

    contracts : dicts avec id, employer, mission, comment, start_date, end_date, hours, gross, net, days_worked,
    cachets, annexe, docs (nombre de documents de ce type déjà joints). Retourne les candidats, du plus probable
    au moins probable.
    """
    a_start, a_end = aem.get("start_date"), aem.get("end_date") or aem.get("start_date")
    partial = partial_reason(aem)
    src = "le bulletin" if aem.get("document") == "bulletin" else "l'AEM"

    results = []
    for c in contracts:
        employer_ok = _same_employer(aem.get("employer"), c["employer"])
        number_ok = _number_found(aem.get("contract_number"), c)
        overlap = bool(a_start) and c["start_date"] <= a_end and a_start <= c["end_date"]
        if not (employer_ok or number_ok) or not (number_ok or overlap):
            continue

        score, reasons, notes, fill = 0, [], [], {}
        if number_ok:
            score += 100
            reasons.append(f"n° de contrat {aem['contract_number']} trouvé")
        if employer_ok:
            score += 20
            reasons.append("même employeur")
        same_start, same_end = a_start == c["start_date"], a_end == c["end_date"]
        if same_start and same_end:
            score += 50
            reasons.append("mêmes dates")
        elif same_start or same_end:
            score += 20
            reasons.append("même date de début" if same_start else "même date de fin")
        elif overlap:
            score += 10
            reasons.append("dates qui se recoupent")
        if number_ok and aem.get("end_date") and not (same_start and same_end):
            notes.append(f"Dates : {_fr_date(a_start)} → {_fr_date(a_end)} sur {src}, "
                         f"{_fr_date(c['start_date'])} → {_fr_date(c['end_date'])} dans l'application.")

        # Heures et montants ne se comparent que si le document couvre exactement ce contrat
        if partial or not (same_start and same_end):
            if partial:
                notes.append(partial)
            notes.append("Heures et montants non comparés.")
        else:
            if aem.get("hours") is not None:
                if abs(aem["hours"] - c["hours"]) < 0.01:
                    score += 10
                    reasons.append("mêmes heures")
                else:
                    notes.append(f"Heures : {aem['hours']:g} h sur {src}, {c['hours']:g} h dans l'application.")
            for field, label in (("gross", "Brut"), ("net", "Net avant impôt")):
                if aem.get(field) is None:
                    continue
                if c.get(field) is None:
                    fill[field] = aem[field]
                elif abs(aem[field] - c[field]) < 0.01:
                    score += 10
                    reasons.append("même brut" if field == "gross" else "même net")
                else:
                    notes.append(f"{label} : {_eur(aem[field])} sur {src}, {_eur(c[field])} dans l'application.")
            if aem.get("days_worked") is not None and c.get("days_worked") is None:
                fill["days_worked"] = aem["days_worked"]
            if c.get("annexe") == 10 and aem.get("cachets") and c.get("cachets") is None:
                fill["cachets"] = aem["cachets"]

        if number_ok and employer_ok:
            level = "certain"
        elif number_ok or (employer_ok and same_start and same_end):
            level = "probable"
        else:
            level = "possible"
        results.append({
            "id": c["id"], "employer": c["employer"], "mission": c["mission"],
            "start_date": c["start_date"], "end_date": c["end_date"], "hours": c["hours"],
            "score": score, "level": level, "reasons": reasons, "notes": notes, "fill": fill,
            "has_doc": bool(c.get("docs")), "best": False,
        })

    results.sort(key=lambda r: (-r["score"], -r["id"]))
    # Présélection seulement si le premier est net : sinon l'utilisateur choisit
    if results and results[0]["level"] in ("certain", "probable") and (
            len(results) == 1 or results[0]["score"] - results[1]["score"] >= 15):
        results[0]["best"] = True
    return results[:5]


# ---------------------------------------------------------------------------
# Exécution isolée : PDF sur l'entrée standard, JSON sur la sortie standard
# ---------------------------------------------------------------------------
def _limit_resources():
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
        resource.setrlimit(resource.RLIMIT_AS, (1 << 30, 1 << 30))
    except (ImportError, ValueError, OSError):
        pass        # plateforme sans limites de ressources : la durée reste bornée par main.py


def run(parse):
    """Lit un PDF sur l'entrée standard, le fait analyser par `parse(words)` et écrit le résultat en JSON."""
    _limit_resources()
    data = sys.stdin.buffer.read(MAX_PDF + 1)
    start = data.find(b"%PDF-", 0, 1024)        # octets parasites avant l'en-tête : on les retire
    if start > 0:
        data = data[start:]
    try:
        result = parse(read_words(data))
    except ValueError as e:
        result = {"error": str(e)}
    except ImportError:
        result = {"error": "La bibliothèque pdfplumber n'est pas installée sur le serveur (pip install -r requirements.txt)."}
    except MemoryError:
        sys.stderr.write("MemoryError\n")
        result = {"error": "Ce PDF est trop lourd à analyser."}
    except Exception as e:      # PDF corrompu, etc. : la cause réelle va dans les journaux du serveur
        sys.stderr.write(f"{type(e).__name__}: {e}\n")
        result = {"error": "Ce PDF est illisible."}
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    run(parse_words)
