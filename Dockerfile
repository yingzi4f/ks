FROM python:3.12-slim AS importer

WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY scripts/import_xls.py scripts/import_xls.py
COPY data/source.xls data/source.xls
RUN mkdir -p web/data data \
    && python scripts/import_xls.py \
        --xls data/source.xls \
        --db data/questions.db \
        --json web/data/questions.json

FROM python:3.12-slim

WORKDIR /app
ENV PROGRESS_DIR=/app/progress
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY web/ /app/web/
COPY --from=importer /build/web/data/questions.json /app/web/data/questions.json
COPY --from=importer /build/data/questions.db /app/web/data/questions.db
COPY server.py /app/server.py
RUN mkdir -p /app/progress

EXPOSE 80
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "80"]
