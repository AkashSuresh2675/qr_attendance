# Use an official lightweight Python image
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Copy requirements file and install dependencies
# We do this before copying the rest of the app to cache the pip install step
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Expose the Flask port
EXPOSE 5000

# Start the application using Gunicorn for production
# Gunicorn will run backend.py's app object
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "backend:app"]
