"""
API Routes — ILI Pipeline Alignment System v10.

Endpoints:
  POST   /api/upload           Upload R1 & R2 Excel files
  POST   /api/run-alignment    Start alignment pipeline (background)
  GET    /api/status/{job_id}  Check job status
  GET    /api/results/{job_id} Get full alignment results as JSON
  GET    /api/download/{job_id} Download Excel report
  GET    /api/health           Health check
  WS     /ws/progress/{job_id} Real-time progress stream
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import sys
import threading
import traceback
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from .schemas import (
    UploadResponse,
    AlignmentRequest,
    JobStatus,
    LayerProgress,
    MatchResultSchema,
    SummaryStats,
    AlignmentResultResponse,
    ProjectCreate,
    ProjectResponse,
)
from .database import get_db, Project, Job
from sqlalchemy.orm import Session
from fastapi import Depends

router = APIRouter()

# ── Penyimpanan in-memory untuk job state ─────────────────────────────────────
# Struktur: jobs[job_id] = {
#   "status": "queued" | "running" | "completed" | "failed",
#   "progress_pct": float,
#   "current_layer": str | None,
#   "message": str,
#   "started_at": str | None,
#   "completed_at": str | None,
#   "logs": list[str],
#   "files": {"r1": path, "r2": path},
#   "report": AlignmentReport | None,
#   "results_df": DataFrame | None,
#   "output_path": str | None,
#   "error": str | None,
#   "ws_clients": list[WebSocket],
# }
jobs: dict = {}

import tempfile

UPLOAD_DIR = Path(tempfile.gettempdir()) / "ili_uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ══════════════════════════════════════════════════════════════════════════════
#  HELPER: Stdout Capture untuk Progress Tracking
# ══════════════════════════════════════════════════════════════════════════════

class ProgressCapture:
    """
    Menangkap stdout dari engine untuk:
    1. Menyimpan log
    2. Mendeteksi transisi layer untuk update progress
    3. Mengirim update via WebSocket
    """

    LAYER_PATTERNS = {
        "[Layer 0]": ("Layer 0: Validasi Data", 0, 10),
        "[Layer 1]": ("Layer 1: Valve Correction", 1, 25),
        "[Layer 2]": ("Layer 2: Weld Matching", 2, 45),
        "[Layer 3]": ("Layer 3: Anomaly Matching", 3, 65),
        "LAYER 4": ("Layer 4: Growth Validation", 4, 85),
        "BAGIAN 12": ("Excel Report Generation", 5, 95),
        "PIPELINE COMPLETE": ("Pipeline Complete", 6, 100),
    }

    def __init__(self, job_id: str, original_stdout):
        self.job_id = job_id
        self.original = original_stdout
        self.buffer = io.StringIO()

    def write(self, text: str):
        if not text.strip():
            return
        try:
            self.original.write(text)
        except UnicodeEncodeError:
            # Windows cp1252 tidak support karakter Unicode box-drawing
            self.original.write(text.encode('ascii', errors='replace').decode('ascii'))
        self.buffer.write(text)

        job = jobs.get(self.job_id)
        if not job:
            return

        for line in text.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            job["logs"].append(line)

            # Deteksi layer transition
            for pattern, (name, layer_num, pct) in self.LAYER_PATTERNS.items():
                if pattern in line:
                    job["current_layer"] = name
                    job["progress_pct"] = pct
                    job["message"] = line
                    # Kirim ke WebSocket clients
                    _broadcast_progress(self.job_id, LayerProgress(
                        layer=layer_num,
                        name=name,
                        status="running" if pct < 100 else "done",
                        message=line,
                        progress_pct=pct,
                        timestamp=datetime.now().isoformat(),
                    ))
                    break

    def flush(self):
        self.original.flush()


def _broadcast_progress(job_id: str, progress: LayerProgress):
    """Kirim progress update ke semua WebSocket clients untuk job ini."""
    job = jobs.get(job_id)
    if not job:
        return
    msg = progress.model_dump_json()
    dead_clients = []
    for ws in job.get("ws_clients", []):
        try:
            asyncio.run(ws.send_text(msg))
        except Exception:
            dead_clients.append(ws)
    for ws in dead_clients:
        job["ws_clients"].remove(ws)


def _run_alignment_thread(job_id: str, params: dict):
    """Background thread yang menjalankan alignment pipeline."""
    job = jobs[job_id]
    job["status"] = "running"
    job["started_at"] = datetime.now().isoformat()
    job["progress_pct"] = 5
    job["message"] = "Starting pipeline..."

    # Capture stdout
    original_stdout = sys.stdout
    capture = ProgressCapture(job_id, original_stdout)
    sys.stdout = capture

    try:
        # Import engine di sini (lazy) agar tidak block startup
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from engine.ili_engine import run_alignment_pipeline, results_to_dataframe

        file_r1 = job["files"]["r1"]
        file_r2 = job["files"]["r2"]
        output_path = str(UPLOAD_DIR / job_id / "alignment_report.xlsx")

        report = run_alignment_pipeline(
            file_r1=file_r1,
            file_r2=file_r2,
            output_path=output_path,
            year_r1=params.get("year_r1"),
            year_r2=params.get("year_r2"),
            vendor_r1=params.get("vendor_r1"),
            vendor_r2=params.get("vendor_r2"),
            wt_mm=params.get("wt_mm", 6.4),
            od_mm=params.get("od_mm", 219.1),
            smys_mpa=params.get("smys_mpa", 359.0),
            maop_bar=params.get("maop_bar", 70.0),
        )

        # Simpan hasil in-memory
        job["report"] = report
        job["results_df"] = results_to_dataframe(report.match_results)
        job["output_path"] = output_path
        job["status"] = "completed"
        job["progress_pct"] = 100
        job["message"] = "Pipeline completed successfully"
        job["completed_at"] = datetime.now().isoformat()
        
        # Simpan ke Database jika project_id ada
        if params.get("project_id"):
            from .database import SessionLocal, Job
            from engine.ffs_engine import generate_ffs_data
            import json
            
            # Pre-generate FFS Data
            ffs_data = generate_ffs_data(
                match_results=report.match_results,
                run1_anomalies=report._corrected_run1.get("anomalies", []),
                run2_anomalies=report._corrected_run2.get("anomalies", []),
                years_between=float(params.get("year_r2", 2) - params.get("year_r1", 0)) if params.get("year_r1") and params.get("year_r2") else 0.0,
                wt_mm=params.get("wt_mm", 6.4),
                od_mm=params.get("od_mm", 219.1),
                smys_mpa=params.get("smys_mpa", 359.0),
                maop_bar=params.get("maop_bar", 70.0)
            )
            ffs_path = str(UPLOAD_DIR / job_id / "ffs_data.json")
            with open(ffs_path, "w") as f:
                json.dump(ffs_data, f)
                
            db = SessionLocal()
            try:
                db_job = Job(
                    id=job_id,
                    project_id=params["project_id"],
                    job_type="alignment",
                    status="completed",
                    result_path=ffs_path  # We point result_path to ffs_path for easy fetching!
                )
                db_job.set_params(params)
                db.add(db_job)
                db.commit()
            except Exception as dbe:
                print(f"Error saving to DB: {dbe}")
            finally:
                db.close()

    except Exception as e:
        job["status"] = "failed"
        job["error"] = str(e)
        job["message"] = f"Error: {str(e)}"
        job["logs"].append(f"ERROR: {traceback.format_exc()}")

    finally:
        sys.stdout = original_stdout

    # Final broadcast
    status = "done" if job["status"] == "completed" else "error"
    _broadcast_progress(job_id, LayerProgress(
        layer=6, name="Pipeline " + job["status"].title(),
        status=status,
        message=job["message"],
        progress_pct=job["progress_pct"],
        timestamp=datetime.now().isoformat(),
    ))


# ══════════════════════════════════════════════════════════════════════════════
#  ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "version": "10.0", "engine": "ILI Pipeline Alignment System"}

# ══════════════════════════════════════════════════════════════════════════════
#  PROJECT ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/api/projects", response_model=ProjectResponse)
def create_project(project: ProjectCreate, db: Session = Depends(get_db)):
    db_project = Project(name=project.name)
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project

@router.get("/api/projects", response_model=list[ProjectResponse])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).order_by(Project.created_at.desc()).all()

@router.get("/api/projects/{project_id}", response_model=ProjectResponse)
def get_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

@router.get("/api/projects/{project_id}/jobs")
def get_project_jobs(project_id: int, db: Session = Depends(get_db)):
    jobs_db = db.query(Job).filter(Job.project_id == project_id).order_by(Job.created_at.desc()).all()
    # We return a custom dict because we don't have a JobResponse schema
    return [{"id": j.id, "type": j.job_type, "status": j.status, "created_at": j.created_at} for j in jobs_db]

from engine.ffs_engine import generate_ffs_data

@router.get("/api/ffs-data/{job_id}")
async def get_ffs_data(job_id: str, db: Session = Depends(get_db)):
    # 1. Coba dari DB dulu
    job_db = db.query(Job).filter(Job.id == job_id).first()
    if job_db and job_db.result_path:
        import json
        if os.path.exists(job_db.result_path):
            with open(job_db.result_path, "r") as f:
                ffs_data = json.load(f)
            return {"status": "ok", "data": ffs_data}
            
    # 2. Jika tidak ada di DB, coba dari memory (fallback)
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found in memory or DB")
    
    job = jobs[job_id]
    if job.get("status") != "completed" or "report" not in job:
        raise HTTPException(status_code=400, detail="Job not completed or report missing")
        
    report = job["report"]
    params = job.get("params", {})
    
    wt = params.get("wt_mm", 6.4)
    od = params.get("od_mm", 219.1)
    smys = params.get("smys_mpa", 359.0)
    maop = params.get("maop_bar", 70.0)
    years_between = 0.0
    
    if params.get("year_r1") and params.get("year_r2"):
        years_between = float(params["year_r2"] - params["year_r1"])
    
    ffs_data = generate_ffs_data(
        match_results=report.match_results,
        run1_anomalies=report._corrected_run1.get("anomalies", []),
        run2_anomalies=report._corrected_run2.get("anomalies", []),
        years_between=years_between,
        wt_mm=wt,
        od_mm=od,
        smys_mpa=smys,
        maop_bar=maop
    )
    
    return {"status": "ok", "data": ffs_data}

@router.post("/api/upload", response_model=UploadResponse)
async def upload_files(
    file_r1: UploadFile = File(..., description="Survey R1 (lama) Excel file"),
    file_r2: UploadFile = File(..., description="Survey R2 (baru) Excel file"),
):
    """Upload dua file Excel survey (R1 = lama, R2 = baru)."""
    job_id = str(uuid.uuid4())[:8]
    job_dir = UPLOAD_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    files_received = []
    paths = {}

    for label, upload_file in [("r1", file_r1), ("r2", file_r2)]:
        if not upload_file.filename:
            raise HTTPException(400, f"File {label} tidak valid")

        # Validasi ekstensi
        ext = Path(upload_file.filename).suffix.lower()
        if ext not in (".xlsx", ".xls", ".xlsm"):
            raise HTTPException(400, f"File {label} harus format Excel (.xlsx/.xls)")

        save_path = job_dir / f"{label}_{upload_file.filename}"
        content = await upload_file.read()
        with open(save_path, "wb") as f:
            f.write(content)

        paths[label] = str(save_path)
        files_received.append(upload_file.filename)

    # Inisialisasi job state
    jobs[job_id] = {
        "status": "queued",
        "progress_pct": 0,
        "current_layer": None,
        "message": "Files uploaded, ready to run",
        "started_at": None,
        "completed_at": None,
        "logs": [],
        "files": paths,
        "report": None,
        "results_df": None,
        "output_path": None,
        "error": None,
        "ws_clients": [],
    }

    return UploadResponse(
        job_id=job_id,
        files_received=files_received,
        message=f"2 files uploaded successfully. Job ID: {job_id}",
    )


@router.post("/api/run-alignment")
async def run_alignment(req: AlignmentRequest):
    """Jalankan alignment pipeline di background thread."""
    job_id = req.job_id
    if job_id not in jobs:
        raise HTTPException(404, f"Job '{job_id}' tidak ditemukan. Upload file dulu.")

    job = jobs[job_id]
    if job["status"] == "running":
        raise HTTPException(409, "Pipeline sedang berjalan untuk job ini.")
    if job["status"] == "completed":
        # Allow re-run
        job["status"] = "queued"
        job["progress_pct"] = 0
        job["logs"] = []
        job["report"] = None
        job["results_df"] = None
        job["error"] = None

    params = req.model_dump(exclude={"job_id"})

    # Jalankan di background thread
    thread = threading.Thread(
        target=_run_alignment_thread,
        args=(job_id, params),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id, "status": "running", "message": "Pipeline started"}


@router.get("/api/status/{job_id}", response_model=JobStatus)
async def get_status(job_id: str):
    """Cek status pekerjaan alignment."""
    if job_id not in jobs:
        raise HTTPException(404, f"Job '{job_id}' tidak ditemukan.")

    job = jobs[job_id]
    return JobStatus(
        job_id=job_id,
        status=job["status"],
        progress_pct=job["progress_pct"],
        current_layer=job.get("current_layer"),
        message=job.get("message", ""),
        started_at=job.get("started_at"),
        completed_at=job.get("completed_at"),
        logs=job.get("logs", [])[-50:],  # Last 50 log lines
    )


@router.get("/api/results/{job_id}", response_model=AlignmentResultResponse)
async def get_results(job_id: str):
    """Ambil hasil alignment lengkap sebagai JSON."""
    if job_id not in jobs:
        raise HTTPException(404, f"Job '{job_id}' tidak ditemukan.")

    job = jobs[job_id]
    if job["status"] != "completed":
        raise HTTPException(400, f"Job belum selesai. Status: {job['status']}")

    report = job["report"]
    df = job["results_df"]

    # Build summary
    summary = SummaryStats(
        n_total=len(report.match_results),
        n_matched=sum(1 for r in report.match_results if r.status in ("MATCHED", "ACTIVE_CORROSION", "STABLE", "SUSPECT_MATCH")),
        n_active_corrosion=sum(1 for r in report.match_results if r.status == "ACTIVE_CORROSION"),
        n_stable=sum(1 for r in report.match_results if r.status == "STABLE"),
        n_suspect=sum(1 for r in report.match_results if r.status == "SUSPECT_MATCH"),
        n_ndf=sum(1 for r in report.match_results if r.status == "NDF"),
        n_new=sum(1 for r in report.match_results if r.status == "NEW_IN_R2"),
        n_valves_r1=report.n_valves_r1,
        n_valves_r2=report.n_valves_r2,
        n_welds_matched=report.n_welds_matched,
        n_welds_unmatched_r1=report.n_welds_unmatched_r1,
        n_welds_unmatched_r2=report.n_welds_unmatched_r2,
        n_spool_pairs=report.n_spool_pairs,
        critical_erf_count=sum(1 for r in report.match_results if r.erf is not None and r.erf >= 1.0),
    )

    # Build results list
    results = []
    for mr in report.match_results:
        results.append(MatchResultSchema(
            spool_id=mr.spool_id,
            anom_id_r1=mr.anom_id_r1,
            anom_id_r2=mr.anom_id_r2,
            delta_odo=mr.delta_odo,
            delta_clock=mr.delta_clock,
            depth_r1=mr.depth_r1,
            depth_r2=mr.depth_r2,
            length_r1=mr.length_r1,
            length_r2=mr.length_r2,
            side=mr.side,
            cost=mr.cost if mr.cost < 1e8 else None,
            status=mr.status,
            flag=mr.flag,
            depth_growth_pct=mr.depth_growth_pct,
            growth_rate_per_yr=mr.growth_rate_per_yr,
            erf=mr.erf,
            remaining_life_yr=mr.remaining_life_yr,
        ))

    return AlignmentResultResponse(
        job_id=job_id,
        summary=summary,
        results=results,
        valve_correction=report.correction_factors or [],
        weld_matching=report.weld_matching_summary[:200] if report.weld_matching_summary else [],
    )


@router.get("/api/download/{job_id}")
async def download_report(job_id: str):
    """Download file Excel report."""
    if job_id not in jobs:
        raise HTTPException(404, f"Job '{job_id}' tidak ditemukan.")

    job = jobs[job_id]
    if job["status"] != "completed":
        raise HTTPException(400, f"Job belum selesai. Status: {job['status']}")

    output_path = job.get("output_path")
    if not output_path or not os.path.exists(output_path):
        raise HTTPException(500, "File report tidak ditemukan.")

    return FileResponse(
        path=output_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"ili_alignment_report_{job_id}.xlsx",
    )


@router.websocket("/ws/progress/{job_id}")
async def ws_progress(websocket: WebSocket, job_id: str):
    """WebSocket untuk streaming progress real-time."""
    await websocket.accept()

    if job_id not in jobs:
        await websocket.send_json({"error": f"Job '{job_id}' not found"})
        await websocket.close()
        return

    job = jobs[job_id]
    job["ws_clients"].append(websocket)

    # Kirim state saat ini
    await websocket.send_json({
        "layer": -1,
        "name": "Connection established",
        "status": job["status"],
        "message": job.get("message", ""),
        "progress_pct": job.get("progress_pct", 0),
        "timestamp": datetime.now().isoformat(),
    })

    try:
        while True:
            # Tunggu pesan dari client (keep-alive)
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_json({"pong": True})
    except WebSocketDisconnect:
        if websocket in job.get("ws_clients", []):
            job["ws_clients"].remove(websocket)
    except Exception:
        if websocket in job.get("ws_clients", []):
            job["ws_clients"].remove(websocket)
