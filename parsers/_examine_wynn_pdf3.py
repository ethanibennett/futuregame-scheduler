import PyPDF2

pdf_path = r"D:\_snbwsop\Wynn_Millions_Structures.pdf"

with open(pdf_path, "rb") as f:
    reader = PyPDF2.PdfReader(f)
    # Check pages around 50-80 for multi-day big events
    for i in [50, 51, 52, 53, 54, 55, 60, 61, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80]:
        text = reader.pages[i].extract_text()
        print(f"\n{'='*80}")
        print(f"PAGE {i+1}")
        print(f"{'='*80}")
        print(text[:1500] if text else "(empty)")
