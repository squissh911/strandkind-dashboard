FROM python:3.12-slim

WORKDIR /app
COPY . .

# Use system pip
RUN pip install --no-cache-dir flask requests authlib google-auth

EXPOSE 9090

CMD ["python3", "app.py"]
