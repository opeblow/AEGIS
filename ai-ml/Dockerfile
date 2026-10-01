# Aegis deal-intelligence service. Runs fully offline with the deterministic
# mock model provider, so no hosted model credentials are needed for a demo.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

RUN adduser --disabled-password --gecos "" app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && chown -R app:app /app

COPY --chown=app:app app ./app
USER app

EXPOSE 8555
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8555/health',timeout=4).status==200 else 1)"

CMD ["uvicorn", "app.api.app:app", "--host", "0.0.0.0", "--port", "8555"]