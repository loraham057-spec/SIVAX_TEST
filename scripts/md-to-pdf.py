# -*- coding: utf-8 -*-
"""Rend un document Markdown de `livrables/` en PDF.

Un rendu depuis le Markdown plutot qu'une mise en page ecrite a la main : le
document de reference reste le fichier .md, versionne avec l'infrastructure, et
le PDF n'en est qu'une vue. Les deux ne peuvent donc pas diverger — c'etait le
defaut des livrables precedents, des PDF sans source.

    python scripts/md-to-pdf.py livrables/DOC.md livrables/DOC.pdf ["Sous-titre"]

Le Markdown accepte, en plus des titres, tableaux et listes : une ligne
`{{schema:nom}}` qui insere l'un des schemas dessines plus bas.
"""
import io
import re
import sys

from reportlab.graphics.shapes import Drawing, Line, PolyLine, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, NextPageTemplate,
                                PageBreak, PageTemplate, Paragraph, Spacer, Table,
                                TableStyle)

SRC = sys.argv[1]
OUT = sys.argv[2]
SOUS_TITRE = sys.argv[3] if len(sys.argv) > 3 else ""

ENCRE = colors.HexColor("#1a1a1a")
GRIS = colors.HexColor("#5f6b76")
FILET = colors.HexColor("#dde2e7")
ACCENT = colors.HexColor("#0b5c8a")
ACCENT2 = colors.HexColor("#0f7f6c")
ALTERNE = colors.HexColor("#f4f6f8")

styles = getSampleStyleSheet()
S = {
    "couvtitre": ParagraphStyle("couvtitre", parent=styles["Title"], fontName="Helvetica-Bold",
                                fontSize=26, leading=31, textColor=ENCRE, alignment=0),
    "couvsous": ParagraphStyle("couvsous", parent=styles["Normal"], fontName="Helvetica",
                               fontSize=12, leading=17, textColor=GRIS, alignment=0),
    "couvmeta": ParagraphStyle("couvmeta", parent=styles["Normal"], fontName="Helvetica",
                               fontSize=9, leading=14, textColor=GRIS, alignment=0),
    "h1": ParagraphStyle("h1", parent=styles["Heading1"], fontName="Helvetica-Bold",
                         fontSize=15, leading=19, textColor=ENCRE, spaceBefore=4, spaceAfter=8),
    "h2": ParagraphStyle("h2", parent=styles["Heading2"], fontName="Helvetica-Bold",
                         fontSize=12.5, leading=16, textColor=ACCENT,
                         spaceBefore=15, spaceAfter=6),
    "h3": ParagraphStyle("h3", parent=styles["Heading3"], fontName="Helvetica-Bold",
                         fontSize=10.5, leading=14, textColor=ENCRE,
                         spaceBefore=10, spaceAfter=4),
    "corps": ParagraphStyle("corps", parent=styles["Normal"], fontName="Helvetica",
                            fontSize=9.5, leading=14, textColor=ENCRE,
                            alignment=TA_JUSTIFY, spaceAfter=7),
    "puce": ParagraphStyle("puce", parent=styles["Normal"], fontName="Helvetica",
                           fontSize=9.5, leading=14, textColor=ENCRE,
                           leftIndent=11, bulletIndent=2, spaceAfter=4),
    "legende": ParagraphStyle("legende", parent=styles["Normal"], fontName="Helvetica-Oblique",
                              fontSize=8.5, leading=12, textColor=GRIS,
                              alignment=TA_CENTER, spaceAfter=10),
    "cell": ParagraphStyle("cell", parent=styles["Normal"], fontName="Helvetica",
                           fontSize=8.5, leading=11.5, textColor=ENCRE),
    "cellg": ParagraphStyle("cellg", parent=styles["Normal"], fontName="Helvetica-Bold",
                            fontSize=8.5, leading=11.5, textColor=colors.white),
}


def inline(t):
    """Gras, code et italique du Markdown vers le balisage de ReportLab."""
    t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
    t = re.sub(r"`(.+?)`", r'<font face="Courier" size="8.5">\1</font>', t)
    t = re.sub(r"(?<!\*)\*([^*]+?)\*(?!\*)", r"<i>\1</i>", t)
    return t


def cellules(ligne):
    return [c.strip() for c in ligne.strip().strip("|").split("|")]


def table(entete, lignes, largeur):
    ncol = len(entete)
    if ncol == 4:
        w = [largeur * 0.28, largeur * 0.26, largeur * 0.26, largeur * 0.20]
    elif ncol == 3:
        w = [largeur * 0.44, largeur * 0.32, largeur * 0.24]
    elif ncol == 2:
        w = [largeur * 0.38, largeur * 0.62]
    else:
        w = [largeur / ncol] * ncol

    data = [[Paragraph(inline(c), S["cellg"]) for c in entete]]
    for l in lignes:
        data.append([Paragraph(inline(c), S["cell"]) for c in l])

    style = [
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 1), (-1, -2), 0.25, FILET),
        ("BOX", (0, 0), (-1, -1), 0.4, FILET),
    ]
    # Les colonnes de montants s'alignent a droite ; les libelles restent a gauche.
    if ncol >= 3 and any("USD" in c or "mois" in c for c in entete):
        style.append(("ALIGN", (-1, 1), (-1, -1), "RIGHT"))
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), ALTERNE))
    dernier = " ".join(lignes[-1]) if lignes else ""
    if "Total" in dernier:
        n = len(data) - 1
        style += [("LINEABOVE", (0, n), (-1, n), 0.8, ACCENT),
                  ("BACKGROUND", (0, n), (-1, n), colors.white)]

    t = Table(data, colWidths=w, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle(style))
    return t


# ─── Schemas ───────────────────────────────────────────────
#
# Dessines plutot qu'importes : un schema genere depuis la meme source que le
# texte ne peut pas rester en retard sur lui, ce qui est le sort habituel des
# images d'architecture.

def _boite(d, x, y, w, h, titre, lignes=(), couleur=ACCENT, remplissage=None):
    d.add(Rect(x, y, w, h, rx=4, ry=4, fillColor=remplissage or colors.white,
               strokeColor=couleur, strokeWidth=0.9))
    d.add(String(x + w / 2, y + h - 13, titre, fontName="Helvetica-Bold",
                 fontSize=8, fillColor=couleur, textAnchor="middle"))
    for i, l in enumerate(lignes):
        d.add(String(x + w / 2, y + h - 24 - i * 9.5, l, fontName="Helvetica",
                     fontSize=7, fillColor=ENCRE, textAnchor="middle"))


def _fleche(d, x1, y1, x2, y2, couleur=GRIS, etiquette=None):
    d.add(Line(x1, y1, x2, y2, strokeColor=couleur, strokeWidth=0.9))
    # Pointe : deux segments courts au bout du trait.
    import math
    ang = math.atan2(y2 - y1, x2 - x1)
    for s in (+1, -1):
        a = ang + s * 2.6
        d.add(Line(x2, y2, x2 + 5 * math.cos(a), y2 + 5 * math.sin(a),
                   strokeColor=couleur, strokeWidth=0.9))
    if etiquette:
        d.add(String((x1 + x2) / 2, (y1 + y2) / 2 + 4, etiquette, fontName="Helvetica",
                     fontSize=6.5, fillColor=GRIS, textAnchor="middle"))


def schema_architecture(largeur):
    d = Drawing(largeur, 250)
    # Cadre du VPC.
    d.add(Rect(8, 8, largeur - 16, 196, rx=5, ry=5, fillColor=colors.HexColor("#fbfcfd"),
               strokeColor=FILET, strokeWidth=0.8, strokeDashArray=[3, 2]))
    d.add(String(largeur * 0.42, 192, "VPC — sous-réseaux publics, privés et données",
                 fontName="Helvetica-Bold", fontSize=7, fillColor=GRIS))

    col = (largeur - 40) / 4.0
    _boite(d, 12, 214, col * 1.1, 30, "Navigateur", ("HTTPS",), ACCENT2)
    _boite(d, 16, 150, col * 1.2, 40, "ALB", ("certificat ACM", "TLS terminé ici"), ACCENT)
    _boite(d, 16 + col * 1.4, 150, col * 1.3, 40, "ingress-nginx",
           ("NodePort 30080", "routage par hôte"), ACCENT)
    _boite(d, 16 + col * 2.9, 150, col * 1.1, 40, "web / ai", ("pods applicatifs",), ACCENT)

    _boite(d, 16, 60, col * 1.2, 46, "RDS PostgreSQL", ("privé", "chiffré"), ACCENT)
    _boite(d, 16 + col * 1.4, 60, col * 1.3, 46, "Secrets Manager", ("monté par CSI", "rôle IRSA du pod"), ACCENT)
    _boite(d, 16 + col * 2.9, 60, col * 1.1, 46, "S3", ("actifs statiques",), ACCENT)

    _boite(d, 16, 16, col * 1.2, 34, "NAT Gateway", ("adresse de sortie fixe",), ACCENT)
    _boite(d, largeur - col * 1.3 - 12, 16, col * 1.3, 34, "SNIS RDC / LLM",
           ("services tiers",), ACCENT2)

    _fleche(d, 12 + col * 0.55, 214, 16 + col * 0.6, 190)
    _fleche(d, 16 + col * 1.2, 170, 16 + col * 1.4, 170)
    _fleche(d, 16 + col * 2.7, 170, 16 + col * 2.9, 170)
    _fleche(d, 16 + col * 3.4, 150, 16 + col * 3.4, 106)
    _fleche(d, 16 + col * 3.2, 150, 16 + col * 2.0, 106)
    _fleche(d, 16 + col * 3.0, 150, 16 + col * 0.6, 106)
    _fleche(d, 16 + col * 0.6, 60, 16 + col * 0.6, 50)
    _fleche(d, 16 + col * 1.2, 33, largeur - col * 1.3 - 12, 33, GRIS, "egress")
    return d


def schema_livraison(largeur):
    d = Drawing(largeur, 150)
    n = 5
    w = (largeur - 20 - (n - 1) * 14) / n
    etapes = [
        ("git push", ("branche dev", "ou prod")),
        ("GitHub Actions", ("lint, types,", "tests, budget")),
        ("Images", ("build + scan", "Trivy")),
        ("ECR", ("dépôt par", "environnement")),
        ("Flux", ("réconcilie", "le cluster")),
    ]
    for i, (t, l) in enumerate(etapes):
        x = 10 + i * (w + 14)
        _boite(d, x, 60, w, 52, t, l, ACCENT if i < 4 else ACCENT2)
        if i:
            _fleche(d, x - 13, 86, x - 2, 86)
    d.add(String(largeur / 2, 36,
                 "Le déploiement est un commit : le pipeline déplace le tag d'image, Flux applique.",
                 fontName="Helvetica-Oblique", fontSize=7.5, fillColor=GRIS, textAnchor="middle"))
    d.add(String(largeur / 2, 22,
                 "Aucun accès au cluster depuis le pipeline — le dépôt reste la seule source de vérité.",
                 fontName="Helvetica-Oblique", fontSize=7.5, fillColor=GRIS, textAnchor="middle"))
    return d


SCHEMAS = {"architecture": schema_architecture, "livraison": schema_livraison}


def construire(md, largeur):
    flow = []
    lignes = md.split("\n")
    i = 0
    while i < len(lignes):
        l = lignes[i]

        m = re.match(r"^\{\{schema:(\w+)\}\}\s*$", l.strip())
        if m:
            flow.append(Spacer(1, 4))
            flow.append(SCHEMAS[m.group(1)](largeur))
            flow.append(Spacer(1, 6))
            i += 1
            continue

        if l.startswith("### "):
            flow.append(Paragraph(inline(l[4:]), S["h3"]))
            i += 1
            continue
        if l.startswith("## "):
            flow.append(Paragraph(inline(l[3:]), S["h2"]))
            i += 1
            continue
        if l.startswith("# "):
            flow.append(Paragraph(inline(l[2:]), S["h1"]))
            i += 1
            continue
        if l.strip() == "---":
            flow.append(PageBreak())
            i += 1
            continue
        if l.startswith("> "):
            flow.append(Paragraph(inline(l[2:]), S["legende"]))
            i += 1
            continue

        if l.startswith("|") and i + 1 < len(lignes) and set(lignes[i + 1].replace("|", "").strip()) <= set("-: "):
            entete = cellules(l)
            corps = []
            i += 2
            while i < len(lignes) and lignes[i].startswith("|"):
                corps.append(cellules(lignes[i]))
                i += 1
            flow.append(Spacer(1, 3))
            flow.append(table(entete, corps, largeur))
            flow.append(Spacer(1, 9))
            continue

        if l.startswith("- ") or l.startswith("* "):
            buf = [l[2:]]
            i += 1
            while i < len(lignes) and lignes[i].strip() and not lignes[i].startswith(("#", "|", "- ", "* ", ">", "{{")):
                buf.append(lignes[i].strip())
                i += 1
            flow.append(Paragraph(inline(" ".join(buf)), S["puce"], bulletText="•"))
            continue

        if l.strip() == "":
            i += 1
            continue

        buf = [l]
        i += 1
        while i < len(lignes) and lignes[i].strip() and not lignes[i].startswith(("#", "|", "- ", "* ", ">", "{{")):
            buf.append(lignes[i])
            i += 1
        flow.append(Paragraph(inline(" ".join(x.strip() for x in buf)), S["corps"]))
    return flow


def couverture(titre, sous_titre, largeur):
    f = [Spacer(1, 55 * mm),
         Paragraph(titre, S["couvtitre"]),
         Spacer(1, 6)]
    if sous_titre:
        f.append(Paragraph(sous_titre, S["couvsous"]))
    f += [Spacer(1, 10),
          Table([[""]], colWidths=[largeur * 0.35], rowHeights=[2],
                style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), ACCENT)])),
          Spacer(1, 14),
          Paragraph("Plateforme SIVAX — infrastructure Amazon Web Services<br/>"
                    "Document établi à partir de l'inventaire du compte AWS.", S["couvmeta"])]
    return f


def pied(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(GRIS)
    canvas.drawString(20 * mm, 12 * mm, TITRE_COURT)
    canvas.drawRightString(A4[0] - 20 * mm, 12 * mm, "page %d" % (doc.page - 1))
    canvas.setStrokeColor(FILET)
    canvas.setLineWidth(0.3)
    canvas.line(20 * mm, 15 * mm, A4[0] - 20 * mm, 15 * mm)
    canvas.restoreState()


def pied_couverture(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(ACCENT)
    canvas.rect(0, A4[1] - 8 * mm, A4[0], 8 * mm, stroke=0, fill=1)
    canvas.restoreState()


md = io.open(SRC, encoding="utf-8").read()
lignes = md.split("\n")
titre = lignes[0].lstrip("# ").strip() if lignes and lignes[0].startswith("# ") else "Document"
corps_md = "\n".join(lignes[1:])
TITRE_COURT = re.sub(r"\s+", " ", titre)[:70]

doc = BaseDocTemplate(OUT, pagesize=A4,
                      leftMargin=20 * mm, rightMargin=20 * mm,
                      topMargin=18 * mm, bottomMargin=20 * mm,
                      title=titre, author="Equipe plateforme SIVAX")
cadre = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="corps")
doc.addPageTemplates([
    PageTemplate(id="couverture", frames=[cadre], onPage=pied_couverture),
    PageTemplate(id="std", frames=[cadre], onPage=pied),
])

flow = couverture(titre, SOUS_TITRE, doc.width)
flow.append(NextPageTemplate("std"))
flow.append(PageBreak())
flow += construire(corps_md, doc.width)
doc.build(flow)
print("PDF ecrit : %s" % OUT)
