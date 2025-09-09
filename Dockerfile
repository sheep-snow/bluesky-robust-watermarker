# https://github.com/aws/aws-lambda-python-runtime-interface-client

# Define custom function directory
ARG FUNCTION_DIR="/function"

FROM public.ecr.aws/docker/library/python:3.10-slim-bookworm as build-image

# Include global arg in this stage of the build
ARG FUNCTION_DIR

# Install aws-lambda-cpp build dependencies
RUN apt-get update && \
  apt-get install -y \
  g++ \
  make \
  cmake \
  unzip \
  libcurl4-openssl-dev

# Install the function's dependencies
RUN pip install \
    --target ${FUNCTION_DIR} \
        awslambdaric

FROM public.ecr.aws/docker/library/python:3.10-slim-bookworm

# Include global arg in this stage of the build
ARG FUNCTION_DIR
# Set working directory to function root directory
WORKDIR ${FUNCTION_DIR}
# Copy in the built dependencies
COPY --from=build-image ${FUNCTION_DIR} ${FUNCTION_DIR}

# Install system dependencies and AWS CLI
RUN apt-get update
RUN apt-get install -y libgl1-mesa-glx
RUN apt-get install -y libgomp1
RUN apt-get install -y libopencv-dev
RUN apt-get install -y git curl unzip
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && aws --version
ENV PYTHONUTF8=1

# Copy Python dependency files
COPY pyproject.toml poetry.toml poetry.lock ${FUNCTION_DIR}/

# Install Python dependencies using poetry
RUN pip install --upgrade pip \
    && pip install poetry \
    && poetry config virtualenvs.create false \
    && poetry config installer.parallel false
RUN poetry install --no-root --only main

# Copy Lambda function code
COPY lambda/ ${FUNCTION_DIR}/lambda/

ENTRYPOINT [ "/usr/local/bin/python", "-m", "awslambdaric" ]
