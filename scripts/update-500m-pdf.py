#!/usr/bin/env python3
"""Recreate 500M.pdf with the updated account name."""
import sys
from pathlib import Path
from pypdf import PdfReader
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

ROOT = Path(__file__).resolve().parent.parent
INPUT = ROOT / '500M.pdf'
OUTPUTS = [ROOT / '500M.pdf', ROOT / 'public' / '500M.pdf']


def main():
    reader = PdfReader(str(INPUT))
    page = reader.pages[0]
    text = page.extract_text() or ''

    # Update account name
    text = text.replace(
        '> SENDER BANK ACCOUNT NAME : EURO TRADE HOLDINGS (SEGREGATED ACCOUNT)',
        '> SENDER BANK ACCOUNT NAME : Treuhand Finanzgruppe Account',
    )

    lines = text.splitlines()
    box = page.mediabox
    width = float(box.width)
    height = float(box.height)

    for out_path in OUTPUTS:
        c = canvas.Canvas(str(out_path), pagesize=(width, height))
        c.setFont('Courier', 10)
        x = 40
        y = height - 60
        line_height = 12
        for line in lines:
            # Truncate extremely long lines to avoid overflow
            if len(line) > 200:
                line = line[:200]
            c.drawString(x, y, line)
            y -= line_height
            if y < 60:
                c.showPage()
                y = height - 60
        c.save()
        print(f'Wrote {out_path}')


if __name__ == '__main__':
    main()
