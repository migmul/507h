FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py ./
COPY templates ./templates
COPY static ./static

# Utilisateur sans privilèges ; le dossier instance/ reçoit la base, les clés et les PDF
RUN useradd --system --uid 1000 --no-create-home app \
    && mkdir -p /app/instance \
    && chown app:app /app/instance
USER app

VOLUME /app/instance
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4).status == 200 else 1)"

# Un seul worker : la limite de tentatives de connexion est en mémoire
CMD ["gunicorn", "--workers", "1", "--threads", "4", "--bind", "0.0.0.0:8000", "--access-logfile", "-", "main:app"]