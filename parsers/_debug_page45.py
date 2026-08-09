import PyPDF2, re, sys
sys.path.insert(0, 'D:/_snbwsop/parsers')
from parse_wynn_structures import normalize_pdf_text, parse_structure_page, classify_page

reader = PyPDF2.PdfReader('D:/_snbwsop/Wynn_Millions_Structures.pdf')
text = reader.pages[44].extract_text()

print("=== RAW TEXT (first 500 chars) ===")
print(repr(text[:500]))

text = normalize_pdf_text(text)
print("\n=== NORMALIZED TEXT (first 500 chars) ===")
print(repr(text[:500]))

print("\n=== LINE BY LINE ===")
lines = [l.strip() for l in text.split('\n') if l.strip()]
for i, line in enumerate(lines[:15]):
    print(f"{i}: [{line}]")

print("\n=== CLASSIFY ===")
print(classify_page(text))

print("\n=== PARSE STRUCTURE ===")
result = parse_structure_page(text)
print(f"event_name: {result.get('event_name')}")
print(f"entry_fee: {result.get('entry_fee')}")
print(f"guarantee: {result.get('guarantee')}")
print(f"level_format: {result.get('level_format')}")
print(f"num_levels: {len(result.get('levels', []))}")
if result.get('levels'):
    print(f"first level: {result['levels'][0]}")
