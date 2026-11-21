"""Titik masuk backend SIS. Jalankan: uvicorn app.main:app --reload --port 8000"""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api import admin_routes, auth_routes, chat_routes, data_routes, oracle_routes
from .config import settings
from .db import engine

PREFIX = "/api/v1"
log = logging.getLogger("uvicorn.error")

app = FastAPI(title="School Intelligence System - SMKN 4 Bandung", version="0.1.0")


# PENTING: middleware ini harus didaftarkan SEBELUM CORSMiddleware. Di Starlette middleware yang didaftarkan
# terakhir menjadi yang terluar; exception_handler(Exception) berjalan di ServerErrorMiddleware (di luar CORS),
# sehingga respons 500-nya tanpa header CORS dan browser melaporkannya sebagai "gagal menghubungi server".
@app.middleware("http")
async def catch_all_and_no_store(request: Request, call_next):
    try:
        response = await call_next(request)
    except Exception:  # noqa: BLE001 - detail hanya ke log server
        log.exception("Kesalahan tak terduga: %s %s", request.method, request.url.path)
        response = JSONResponse({"error": {"code": "INTERNAL", "message": "Terjadi kesalahan di server.", "details": None}}, status_code=500)
    response.headers.setdefault("Cache-Control", "no-store")  # data siswa jangan masuk cache peramban/proxy
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,  # token lewat header Authorization, bukan cookie
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(auth_routes.router, prefix=PREFIX)
app.include_router(data_routes.router, prefix=PREFIX)
app.include_router(chat_routes.router, prefix=PREFIX)
app.include_router(admin_routes.router, prefix=PREFIX)
app.include_router(oracle_routes.router, prefix=PREFIX)


# Didaftarkan pada kelas dasar Starlette agar 404/405 bawaan router juga memakai format {error:{...}}
# (handler untuk fastapi.HTTPException saja tidak menangkapnya).
@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "ERROR", "message": str(exc.detail), "details": None}
    return JSONResponse({"error": detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    # jsonable: ctx dapat memuat objek non-JSON (mis. ValueError) yang membuat respons 422 itu sendiri gagal
    errors = [{"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]
    return JSONResponse({"error": {"code": "VALIDATION_ERROR", "message": "Input tidak valid.", "details": errors}}, status_code=422)


@app.get(f"{PREFIX}/health", tags=["sistem"])
def health():
    tahun_ajaran = "2026/2027"
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            row = conn.execute(text("SELECT tahun_ajaran FROM periode_akademik WHERE status = 'berjalan' LIMIT 1")).first()
            if row and row[0]:
                tahun_ajaran = str(row[0])
        database = "ok"
    except Exception:  # noqa: BLE001 - status saja, tanpa membocorkan detail
        database = "error"
    return {
        "status": "ok" if database == "ok" else "degraded",
        "database": database,
        "tahun_ajaran": tahun_ajaran,
        "rag": "pencarian leksikal (profil_sekolah.json)",
        "gemini": "aktif" if settings.gemini_api_key else "tidak aktif (mode aturan)",
        "gemini_kirim_data": bool(settings.gemini_api_key and settings.gemini_send_data),
        "oracle_public": settings.oracle_allow_anon,
    }
