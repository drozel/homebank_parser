FROM python:3.9-buster

WORKDIR /usr/src/homeparser

RUN apt-get update && apt-get install -y locales-all

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY start.py .
COPY db_connector.py .
COPY homeparser.py .


ENTRYPOINT ["python", "./start.py"]
