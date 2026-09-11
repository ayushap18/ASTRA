FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY services/intelligence/requirements.lock ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock && useradd --system --uid 10001 astra
COPY services/intelligence/app/ ./app/
USER astra
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
