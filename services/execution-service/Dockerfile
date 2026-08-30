FROM python:3.11-slim
WORKDIR /app
COPY services/execution-service/requirements.txt /app/requirements.txt
COPY services/_shared /app/services/_shared
RUN pip install --no-cache-dir -r /app/requirements.txt && pip install --no-cache-dir -e /app/services/_shared
COPY services/execution-service/app /app/app
EXPOSE 8003
CMD ["uvicorn", "app.api:app", "--host", "0.0.0.0", "--port", "8003"]
