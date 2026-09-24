FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /srv/ai-ml

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# The service credential is read from the environment at startup.
ENV AEGIS_AI_PORT=8555

EXPOSE 8555

# Bind to 0.0.0.0 inside the container; the container network is private and
# the endpoint still demands the bearer token.
CMD ["uvicorn", "app.api.app:app", "--host", "0.0.0.0", "--port", "8555"]