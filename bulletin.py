"""Lecture d'un bulletin de paie de France Télévisions (intermittent) et indices tirés de son nom de fichier.

Deux usages, comme aem.py :
- importé par main.py : `filename_hint` ;
- lancé comme script (`python bulletin.py < fichier.pdf`) : lit un PDF sur l'entrée standard et écrit un JSON sur la
  sortie standard, dans un sous-processus à durée et mémoire limitées.

Le rattachement à un contrat réutilise `match_contracts` d'aem.py. Il y a un bulletin par contrat : il couvre
le contrat entier, heures et montants compris.

Seuls les champs utiles au suivi sont lus (employeur, emploi, dates, heures, jours, brut, net avant impôt).
L'identité, l'adresse, le numéro de sécurité sociale, les coordonnées bancaires et les cumuls ne sont jamais extraits.
"""
import re

from aem import _date, _number, contract_number, fold, run

MONTHS = ("janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre",
          "novembre", "decembre")
AMOUNT = re.compile(r"-?\d+,\d+")


def _lines(words):
    """Regroupe les mots par ligne (même hauteur à 3 points près), de haut en bas puis de gauche à droite."""
    lines = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(w["top"] - lines[-1][0]["top"]) <= 3:
            lines[-1].append(w)
        else:
            lines.append([w])
    return [sorted(line, key=lambda w: w["x0"]) for line in lines]


def _text(line):
    return fold(" ".join(w["text"] for w in line))


def _amounts(line):
    return [_number(w["text"]) for w in line if AMOUNT.fullmatch(w["text"])]


def _find_line(lines, phrase):
    return next((line for line in lines if phrase in _text(line)), None)


def parse_words(words):
    """Extrait les champs utiles d'un bulletin de paie à partir des mots (avec coordonnées) de sa première page."""
    lines = _lines(words)
    text = " ".join(_text(line) for line in lines)
    if "attestation" in text and "annexes 8 et 10" in text:
        raise ValueError("Ce PDF est une AEM : utilise « Importer une AEM ».")
    if "bulletin de paie" not in text or "net a payer avant impot" not in text:
        raise ValueError("Ce PDF ne ressemble pas à un bulletin de paie de France Télévisions.")

    out, warnings = {"document": "bulletin"}, []

    # Titre : « BULLETIN DE PAIE SEPTEMBRE 2026 DU 02/09/2026 AU 06/09/2026 » (mois de paie, puis période du contrat)
    title = _find_line(lines, "bulletin de paie")
    m = title and re.search(r"bulletin de paie\s+([a-z]+)\s+(\d{4})\s+du\s+(\d{2})/(\d{2})/(\d{4})\s+au\s+(\d{2})/(\d{2})/(\d{4})",
                            _text(title))
    if m and m.group(1) in MONTHS:
        out["month"] = f"{m.group(2)}-{MONTHS.index(m.group(1)) + 1:02d}"
        out["start_date"] = _date(list(m.group(3, 4, 5)))
        out["end_date"] = _date(list(m.group(6, 7, 8)))

    # Date de paiement
    line = _find_line(lines, "paiement effectue le")
    if line:
        m = re.search(r"paiement effectue le\s+(\d{2})/(\d{2})/(\d{4})", _text(line))
        out["pay_date"] = _date(list(m.groups())) if m else None

    # Employeur : à gauche de « APE » dans l'en-tête
    ape = next((w for w in words if w["text"] == "APE"), None)
    if ape:
        row = next(line for line in lines if ape in line)
        name = [w["text"] for w in row if w["x1"] < ape["x0"] - 2]
        out["employer"] = " ".join(name) or None

    # Emploi : « FONCTION/EMPLOI:74309   MONTEUR » ; le n° de contrat est dans le coin droit, juste en dessous
    for i, line in enumerate(lines):
        if line[0]["text"].upper().startswith("FONCTION/EMPLOI"):
            job = [w["text"] for w in line[1:] if w["x0"] < 400]
            out["job_title"] = " ".join(job) or None
            top = line[0]["top"]
            found = [w for other in lines[i + 1:i + 4] if 0 < other[0]["top"] - top <= 30
                     for w in other if w["x0"] > 400 and re.fullmatch(r"\d{4,10}", w["text"])]
            numbers = [w["text"] for w in sorted(found, key=lambda w: w["x0"])]
            out["contract_numbers"] = numbers
            out["contract_number"] = contract_number(numbers[::-1])      # le plus à droite : le matricule est à gauche
            break

    # Salaire brut : « SALAIRE BRUT   24,00   793,55 » -> heures (base) et brut (dernier montant de la ligne)
    line = _find_line(lines, "salaire brut")
    if line:
        values = _amounts(line)
        if values:
            out["gross"] = values[-1]
            out["hours"] = values[0] if len(values) > 1 else None

    # Journées : lignes « JOURNEES   3,00   180,160   540,48 » (la base est le nombre de jours)
    days = None
    for line in lines:
        values = _amounts(line)
        first = next((i for i, w in enumerate(line) if AMOUNT.fullmatch(w["text"])), None)
        if values and first and fold(" ".join(w["text"] for w in line[:first])) in ("journee", "journees"):
            days = (days or 0) + values[0]
    out["days_worked"] = days

    # Net avant impôt sur le revenu (et non le net payé, qui tient compte du prélèvement à la source)
    line = _find_line(lines, "net a payer avant impot")
    values = _amounts(line) if line else []
    out["net"] = values[-1] if values else None

    if not (out.get("employer") and out.get("start_date") and out.get("end_date") and out.get("gross") is not None):
        raise ValueError("Impossible de lire ce bulletin de paie : mise en page inconnue.")
    if out["end_date"] < out["start_date"]:
        warnings.append("La date de fin précède la date de début : vérifie le document.")
    if out["net"] is not None and out["net"] > out["gross"]:
        warnings.append("Le net dépasse le brut : vérifie le document.")
    for key, label in (("hours", "heures"), ("net", "net avant impôt")):
        if out.get(key) is None:
            warnings.append(f"{label[0].upper()}{label[1:]} non lu(e) : à renseigner à la main.")
    out["warnings"] = warnings
    return out


def filename_hint(name):
    """Indices tirés du nom de fichier : BULLETIN-CONTRAT-000125-DU-02-09-2026-AU-06-09-2026.pdf."""
    m = re.search(r"BULLETIN-CONTRAT-(\d+)-DU-(\d{2})-(\d{2})-(\d{4})-AU-(\d{2})-(\d{2})-(\d{4})", name or "", re.I)
    if not m:
        return {}
    n, d1, m1, y1, d2, m2, y2 = m.groups()
    return {"contract_number": n, "start_date": _date([d1, m1, y1]), "end_date": _date([d2, m2, y2])}


if __name__ == "__main__":
    run(parse_words)
