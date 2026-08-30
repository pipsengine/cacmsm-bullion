FROM python:3.11-slim
WORKDIR /app
COPY services/control-api/requirements.txt /app/requirements.txt
COPY services/_shared /app/services/_shared
RUN pip install --no-cache-dir -r /app/requirements.txt && pip install --no-cache-dir -e /app/services/_shared
COPY services/control-api/app /app/app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
