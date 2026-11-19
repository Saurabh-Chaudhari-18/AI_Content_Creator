FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /code

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini .
COPY seeds ./seeds

RUN useradd --create-home appuser && mkdir -p /code/uploads && chown appuser /code/uploads
USER appuser

EXPOSE 8000
# WEB_CONCURRENCY sets the number of API processes (uvicorn reads it).
ENV WEB_CONCURRENCY=2
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
