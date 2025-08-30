# Lambda container image
FROM public.ecr.aws/lambda/python:3.10

# Install system dependencies and AWS CLI
RUN cat /etc/system-release \
    && yum update -y \
    && yum install -y unzip git gcc python3-devel mesa-libGL libgomp opencv \
    && curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && aws --version
ENV PYTHONUTF8=1

# Copy Python dependency files
COPY pyproject.toml poetry.toml poetry.lock ${LAMBDA_TASK_ROOT}/

# Install Python dependencies using poetry
RUN pip install --upgrade pip \
    && pip install poetry \
    && poetry config virtualenvs.create false \
    && poetry install --no-root --only main

# Copy Lambda function code
COPY lambda/ ${LAMBDA_TASK_ROOT}/lambda/

# Set default command (can be overridden)
# CMD ["lambda.batch.embed_spectrum_watermark.handler"]
