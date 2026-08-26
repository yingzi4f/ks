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

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY web/ /usr/share/nginx/html/
COPY --from=importer /build/web/data/questions.json /usr/share/nginx/html/data/questions.json
COPY --from=importer /build/data/questions.db /usr/share/nginx/html/data/questions.db

EXPOSE 80
