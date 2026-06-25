"""
ILI Pipeline Alignment System v10 — FastAPI Application.

Jalankan:
    cd backend
    uvicorn main:app --reload --port 8000

Atau:
    python main.py
"""
import os
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Pastikan backend ada di sys.path
sys.path.insert(0, str(Path(__file__).parent))

from api.routes import router

app = FastAPI(
    title="ILI Pipeline Alignment System",
    version="10.0",
    description="4-Layer Sequential Hierarchical Alignment Engine for ILI Data",
)

# CORS — izinkan semua origin untuk development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API router
app.include_router(router)

# Serve frontend static files
frontend_dir = Path(__file__).parent.parent / "frontend"
if frontend_dir.exists():
    # Mount CSS dan JS sebagai static
    app.mount("/static", StaticFiles(directory=str(frontend_dir)), name="static")

    @app.get("/", include_in_schema=False)
    async def serve_frontend():
        """Serve halaman utama frontend."""
        index_path = frontend_dir / "index.html"
        if index_path.exists():
            return FileResponse(str(index_path))
        return {"error": "Frontend not found"}


if __name__ == "__main__":
    import uvicorn
    print("\n" + "=" * 60)
    print("  ILI Pipeline Alignment System v10.0")
    print("  Starting server at http://localhost:8000")
    print("=" * 60 + "\n")
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=[str(Path(__file__).parent)],
    )
