FROM python:3.11-slim
WORKDIR /app
COPY services/decision-service/requirements.txt /app/requirements.txt
COPY services/_shared /app/services/_shared
RUN pip install --no-cache-dir -r /app/requirements.txt && pip install --no-cache-dir -e /app/services/_shared
COPY services/decision-service/app /app/app
EXPOSE 8002
CMD ["uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", "8002"]
