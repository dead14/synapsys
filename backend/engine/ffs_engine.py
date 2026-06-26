from typing import List, Dict, Any

def generate_ffs_data(
    match_results: list,
    run1_anomalies: list,
    run2_anomalies: list,
    years_between: float,
    wt_mm: float,
    od_mm: float,
    smys_mpa: float,
    maop_bar: float
) -> List[Dict[str, Any]]:
    """
    Mengambil hasil AlignmentReport dan merekonstruksi data dengan skema absolut
    yang dibutuhkan oleh FFS Assessment (mengembalikan format JSON list of dicts).
    """
    
    # Buat lookup dictionary untuk akses super cepat (O(1))
    r1_lookup = {a["id"]: a for a in run1_anomalies}
    r2_lookup = {a["id"]: a for a in run2_anomalies}

    ffs_rows = []

    # Filter hanya anomali yang MATCHED dan tervalidasi di Layer 4
    for mr in match_results:
        if mr.status not in ("ACTIVE_CORROSION", "STABLE", "SUSPECT_MATCH"):
            continue
            
        a1 = r1_lookup.get(mr.anom_id_r1)
        a2 = r2_lookup.get(mr.anom_id_r2)
        
        if not a2:
            continue

        # Hitung Corrosion Rate untuk Kedalaman (mm/year)
        cr_depth = 0.0
        if mr.growth_rate_per_yr and mr.growth_rate_per_yr > 0:
            cr_depth = (mr.growth_rate_per_yr / 100.0) * wt_mm

        # Hitung Corrosion Rate untuk Panjang (mm/year)
        cr_length = 0.0
        if a1 and a2 and a2.get("length") is not None and a1.get("length") is not None:
            delta_len = a2["length"] - a1["length"]
            if delta_len > 0 and years_between > 0:
                cr_length = delta_len / years_between

        row = {
            "LD [m]": a2.get("log_distance_m", 0.0),
            "Section": mr.spool_id or "",
            "Surface": a2.get("surface_location", "External"),
            "Max Depth [%]": a2.get("depth", 0.0),
            "Length [mm]": a2.get("length", 0.0),
            "Width [mm]": a2.get("width", 0.0),
            "Orient. (hrs:mins)": a2.get("clock_position", "12:00"),
            "Nominal Wall Thickness [mm]": wt_mm,
            "CR Depth [mm/y]": round(cr_depth, 4),
            "CR Length [mm/y]": round(cr_length, 4),
            "Design Factor": 0.72,  # Standard B31G assumption if unknown
            "Outer Diameter Ds": od_mm,
            "SMYS [MPa]": smys_mpa,
            "Operating Pressure P₀ [MPa]": maop_bar / 10.0  # Konversi bar ke MPa (1 bar = 0.1 MPa)
        }
        
        ffs_rows.append(row)

    return ffs_rows
