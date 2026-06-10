# Poster Kadai Print Layout Generator

A modern print-shop tool for uploading poster artwork and generating print-ready A3 layouts for A4, A5, A6, and mixed poster combinations.

## Stack

- Next.js, React, TailwindCSS
- Konva / react-konva for the live A3 preview
- Python FastAPI backend
- Pillow, OpenCV, ReportLab for production rendering

## Run

```bash
npm install
npm run dev
```

Optional production backend:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt
npm run backend
```

The frontend includes client-side JPG, PNG, and PDF export so the workflow is usable even before the backend is started. The FastAPI backend mirrors the same print requirements for server-side 300 DPI PDF/image generation and CMYK-ready rendering.
