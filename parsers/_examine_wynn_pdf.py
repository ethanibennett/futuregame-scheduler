import PyPDF2
import sys

pdf_path = r"D:\_snbwsop\Wynn_Millions_Structures.pdf"

with open(pdf_path, "rb") as f:
    reader = PyPDF2.PdfReader(f)
    total_pages = len(reader.pages)
    print(f"Total pages: {total_pages}")

    # Print first 10 pages to understand structure
    for i in range(min(10, total_pages)):
        text = reader.pages[i].extract_text()
        print(f"\n{'='*80}")
        print(f"PAGE {i+1}")
        print(f"{'='*80}")
        print(text[:2000] if text else "(empty)")
        print(f"... (total chars: {len(text) if text else 0})")
