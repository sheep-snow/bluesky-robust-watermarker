# Ubuntu-based Lambda runtime with PyTorch CPU support
ARG FUNCTION_DIR="/function"

# Build stage
FROM public.ecr.aws/docker/library/python:3.12-slim-bookworm as build-image

ARG FUNCTION_DIR

# Install build dependencies
RUN apt-get update && \
    apt-get install -y \
    g++ \
    make \
    cmake \
    unzip \
    libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install AWS Lambda runtime interface client
RUN pip install \
    --target ${FUNCTION_DIR} \
    awslambdaric

# Runtime stage
FROM public.ecr.aws/docker/library/python:3.12-slim-bookworm

ARG FUNCTION_DIR
WORKDIR ${FUNCTION_DIR}

# Copy Lambda runtime from build stage
COPY --from=build-image ${FUNCTION_DIR} ${FUNCTION_DIR}

# Install runtime dependencies
RUN apt-get update && \
    apt-get install -y \
    libgl1-mesa-glx \
    libgomp1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libfontconfig1 \
    git \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*
# Install AWS CLI
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf awscliv2.zip aws \
    && aws --version

ENV PYTHONUTF8=1

# Copy Python dependency files
COPY pyproject.toml poetry.toml poetry.lock ${FUNCTION_DIR}/

# Install Python dependencies using poetry
RUN pip install --upgrade pip \
    && pip install poetry \
    && poetry config virtualenvs.create false \
    && poetry config installer.parallel false \
    && poetry install --no-root --only main

# Copy and run TrustMark model download script
COPY download_trustmark_models.py ${FUNCTION_DIR}/
RUN mkdir -p /tmp/trustmark_models && python3 ${FUNCTION_DIR}/download_trustmark_models.py

# Copy Lambda function code
COPY lambda/ ${FUNCTION_DIR}/lambda/

ENTRYPOINT [ "/usr/local/bin/python", "-m", "awslambdaric" ]
