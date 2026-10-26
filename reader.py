"""Lecture d'un PDF importé : reconnaît une AEM ou un bulletin de paie, puis appelle le bon lecteur.

Lancé comme script par main.py (`python reader.py < fichier.pdf`) dans un sous-processus à durée et mémoire limitées,
car un PDF est un fichier non fiable. Le résultat porte `document` : « aem » ou « bulletin ».
"""
import aem
import bulletin
from aem import fold, run


def parse_words(words):
    text = fold(" ".join(w["text"] for w in words))
    if "bulletin de paie" in text and "net a payer avant impot" in text:
        return bulletin.parse_words(words)
    if "attestation" in text and "annexes 8 et 10" in text:
        doc = aem.parse_words(words)
        doc["document"] = "aem"
        return doc
    raise ValueError("Ce PDF n'est ni une AEM ni un bulletin de paie de France Télévisions.")


if __name__ == "__main__":
    run(parse_words)
