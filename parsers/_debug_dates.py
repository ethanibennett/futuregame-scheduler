import PyPDF2, re
import sys
sys.path.insert(0, 'D:/_snbwsop/parsers')
from parse_wynn_structures import normalize_pdf_text

reader = PyPDF2.PdfReader('D:/_snbwsop/Wynn_Millions_Structures.pdf')

# HORSE T&C is page 19 (index 18)
print("=== PAGE 19 (HORSE TC) ===")
text = reader.pages[18].extract_text()
text = normalize_pdf_text(text)
for line in text.split('\n')[:20]:
    stripped = line.strip()
    if stripped:
        print(f"  [{stripped}]")

print()

# PKO T&C is page 29 (index 28) - and continuation page 30 (index 29)
print("=== PAGE 29 (PKO TC) ===")
text = reader.pages[28].extract_text()
text = normalize_pdf_text(text)
for line in text.split('\n')[:20]:
    stripped = line.strip()
    if stripped:
        print(f"  [{stripped}]")
