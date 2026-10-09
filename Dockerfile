# pdf-web-tool — Flask + img2pdf/pikepdf/Pillow
# Code & data (storage/) dipasang live via bind mount (.:/app).

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 5001
CMD ["python", "-c", "import os, app; app.app.run(host='0.0.0.0', port=int(os.environ.get('PORT','5001')), debug=False)"]