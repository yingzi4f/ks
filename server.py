#!/usr/bin/env python3
"""静态页面 + 按用户名保存刷题进度。"""

from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
PROGRESS_DIR = Path(os.environ.get("PROGRESS_DIR", ROOT / "progress"))
DB_PATH = PROGRESS_DIR / "progress.db"
USER_RE = re.compile(r"^[\u4e00-\u9fffA-Za-z0-9_\-]{1,20}$")


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def normalize_username(name: str) -> str:
    text = (name or "").strip()
    if not USER_RE.fullmatch(text):
        raise HTTPException(400, "用户名请用 1 到 20 个汉字、字母或数字")
    return text


def db() -> sqlite3.Connection:
    PROGRESS_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS progress (
            username TEXT PRIMARY KEY,
            deck TEXT NOT NULL DEFAULT 'seq',
            idx INTEGER NOT NULL DEFAULT 0,
            ids_json TEXT NOT NULL DEFAULT '[]',
            records_json TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    return conn


class LoginIn(BaseModel):
    username: str


class ProgressIn(BaseModel):
    deck: str = "seq"
    index: int = 0
    ids: list[int] = Field(default_factory=list)
    records: dict = Field(default_factory=dict)


app = FastAPI(title="保安员考试")


@app.post("/api/login")
def login(body: LoginIn):
    username = normalize_username(body.username)
    conn = db()
    try:
        row = conn.execute(
            "SELECT username FROM progress WHERE username = ?", (username,)
        ).fetchone()
        if not row:
            conn.execute(
                """
                INSERT INTO progress (username, deck, idx, ids_json, records_json, updated_at)
                VALUES (?, 'seq', 0, '[]', '{}', ?)
                """,
                (username, utcnow()),
            )
            conn.commit()
    finally:
        conn.close()
    return {"username": username}


@app.get("/api/progress/{username}")
def get_progress(username: str):
    name = normalize_username(username)
    conn = db()
    try:
        row = conn.execute(
            "SELECT deck, idx, ids_json, records_json FROM progress WHERE username = ?",
            (name,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return {"username": name, "deck": "seq", "index": 0, "ids": [], "records": {}}
    deck, idx, ids_json, records_json = row
    try:
        ids = json.loads(ids_json or "[]")
        records = json.loads(records_json or "{}")
    except json.JSONDecodeError:
        ids, records = [], {}
    return {
        "username": name,
        "deck": deck or "seq",
        "index": int(idx or 0),
        "ids": ids if isinstance(ids, list) else [],
        "records": records if isinstance(records, dict) else {},
    }


@app.put("/api/progress/{username}")
def put_progress(username: str, body: ProgressIn):
    name = normalize_username(username)
    deck = body.deck if body.deck in {"seq", "rand", "wrong"} else "seq"
    index = max(0, int(body.index))
    ids = []
    for item in body.ids:
        try:
            n = int(item)
        except (TypeError, ValueError):
            continue
        if n > 0:
            ids.append(n)
    records = body.records if isinstance(body.records, dict) else {}
    conn = db()
    try:
        conn.execute(
            """
            INSERT INTO progress (username, deck, idx, ids_json, records_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
                deck = excluded.deck,
                idx = excluded.idx,
                ids_json = excluded.ids_json,
                records_json = excluded.records_json,
                updated_at = excluded.updated_at
            """,
            (
                name,
                deck,
                index,
                json.dumps(ids, ensure_ascii=False),
                json.dumps(records, ensure_ascii=False),
                utcnow(),
            ),
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "username": name}


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")


app.mount("/css", StaticFiles(directory=str(WEB / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(WEB / "js")), name="js")
app.mount("/data", StaticFiles(directory=str(WEB / "data")), name="data")
