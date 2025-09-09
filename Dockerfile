# https://github.com/aws/aws-lambda-python-runtime-interface-client

# Define custom function directory
ARG FUNCTION_DIR="/function"

FROM public.ecr.aws/docker/library/python:3.12-alpine as build-image

# Include global arg in this stage of the build
ARG FUNCTION_DIR

# https://blog.whoelsebut.me/inexpensive-receipt-repository-ocr
# Install aws-lambda-cpp build dependencies
RUN apk update && \
    apk add --no-cache build-base \
    jpeg-dev \
    zlib-dev \
    cmake \
    g++ \
    make \
    unzip \
    curl-dev \
    autoconf \
    automake \
    libtool \
    linux-headers \
    musl-dev

# Install the function's dependencies
# Skip awslambdaric for now and use alternative approach
RUN pip install --target ${FUNCTION_DIR} mangum fastapi


FROM public.ecr.aws/docker/library/python:3.12-alpine

# Include global arg in this stage of the build
ARG FUNCTION_DIR
# Set working directory to function root directory
WORKDIR ${FUNCTION_DIR}
# Copy in the built dependencies
COPY --from=build-image ${FUNCTION_DIR} ${FUNCTION_DIR}

# Install system dependencies
RUN apk update && apk add --no-cache mesa-gl libgomp opencv git curl unzip

# Copy Python dependency files
COPY pyproject.toml poetry.toml poetry.lock ${FUNCTION_DIR}/

# Install Python dependencies using poetry
RUN pip install --upgrade pip \
    && pip install poetry \
    && poetry config virtualenvs.create false
# && poetry config installer.parallel false
RUN poetry install --no-root --only main --no-dev || \
    (pip install boto3 pillow && echo "Fallback to pip install")

# Copy Lambda function code
COPY lambda/ ${FUNCTION_DIR}/lambda/

ENTRYPOINT [ "/usr/local/bin/python" ]
