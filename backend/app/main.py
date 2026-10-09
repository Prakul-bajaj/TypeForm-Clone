from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import models  # noqa: F401  (registers tables on Base.metadata)
from .config import CORS_ORIGINS, SEED_DEMO
from .database import Base, SessionLocal, engine, ensure_columns
from .routers import auth, forms, public, questions, results, themes, uploads


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(engine)
    ensure_columns()  # upgrade databases created before authentication existed
    if SEED_DEMO:
        from .seed import seed_if_empty

        with SessionLocal() as db:
            seed_if_empty(db)
    yield


app = FastAPI(
    title="Typeform Clone API",
    version="1.0.0",
    description="Form builder, public respondent runtime and results API.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(forms.router)
app.include_router(questions.router)
app.include_router(results.router)
app.include_router(public.router)
app.include_router(uploads.router)
app.include_router(themes.router)


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok"}
