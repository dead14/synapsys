"""
Pydantic schemas untuk ILI Pipeline Alignment API.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class UploadResponse(BaseModel):
    """Response setelah upload file berhasil."""
    job_id: str
    files_received: list[str]
    message: str = "Files uploaded successfully"


class AlignmentRequest(BaseModel):
    """Request body untuk menjalankan alignment pipeline."""
    job_id: str
    year_r1: Optional[int] = None
    year_r2: Optional[int] = None
    vendor_r1: Optional[str] = None
    vendor_r2: Optional[str] = None
    wt_mm: float = 6.4
    od_mm: float = 219.1
    smys_mpa: float = 359.0
    maop_bar: float = 70.0


class JobStatus(BaseModel):
    """Status pekerjaan alignment."""
    job_id: str
    status: str = "queued"  # queued | running | completed | failed
    progress_pct: float = 0.0
    current_layer: Optional[str] = None
    message: str = ""
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    logs: list[str] = Field(default_factory=list)


class LayerProgress(BaseModel):
    """Update progress per layer — dikirim via WebSocket."""
    layer: int
    name: str
    status: str  # pending | running | done | error
    message: str = ""
    progress_pct: float = 0.0
    timestamp: str = ""


class MatchResultSchema(BaseModel):
    """Satu hasil pencocokan anomali."""
    spool_id: Optional[str] = None
    anom_id_r1: Optional[str] = None
    anom_id_r2: Optional[str] = None
    delta_odo: Optional[float] = None
    delta_clock: Optional[float] = None
    depth_r1: Optional[float] = None
    depth_r2: Optional[float] = None
    length_r1: Optional[float] = None
    length_r2: Optional[float] = None
    side: Optional[str] = None
    cost: Optional[float] = None
    status: str = "UNVALIDATED"
    flag: str = ""
    depth_growth_pct: Optional[float] = None
    growth_rate_per_yr: Optional[float] = None
    erf: Optional[float] = None
    remaining_life_yr: Optional[float] = None


class SummaryStats(BaseModel):
    """Ringkasan statistik alignment."""
    n_total: int = 0
    n_matched: int = 0
    n_active_corrosion: int = 0
    n_stable: int = 0
    n_suspect: int = 0
    n_ndf: int = 0
    n_new: int = 0
    n_valves_r1: int = 0
    n_valves_r2: int = 0
    n_welds_matched: int = 0
    n_welds_unmatched_r1: int = 0
    n_welds_unmatched_r2: int = 0
    n_spool_pairs: int = 0
    critical_erf_count: int = 0


class AlignmentResultResponse(BaseModel):
    """Response lengkap hasil alignment."""
    job_id: str
    summary: SummaryStats
    results: list[MatchResultSchema] = Field(default_factory=list)
    valve_correction: list[dict] = Field(default_factory=list)
    weld_matching: list[dict] = Field(default_factory=list)
