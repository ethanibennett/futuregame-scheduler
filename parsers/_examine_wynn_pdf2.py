import PyPDF2

pdf_path = r"D:\_snbwsop\Wynn_Millions_Structures.pdf"

with open(pdf_path, "rb") as f:
    reader = PyPDF2.PdfReader(f)
    total_pages = len(reader.pages)

    # Print pages 10-20, 40-50, 80-90 to see variety
    ranges = [(10, 20), (40, 50), (80, 90)]
    for start, end in ranges:
        for i in range(start, min(end, total_pages)):
            text = reader.pages[i].extract_text()
            print(f"\n{'='*80}")
            print(f"PAGE {i+1}")
            print(f"{'='*80}")
            print(text[:1500] if text else "(empty)")
