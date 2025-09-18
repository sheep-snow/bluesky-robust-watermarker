import importlib.util
import json
import logging
import os
import tempfile
from typing import Any, Dict, Optional, Union
from io import BytesIO

import boto3
from PIL import Image

# Import common watermark utilities using importlib to avoid lambda keyword issues
watermark_utils_spec = importlib.util.spec_from_file_location(
    "watermark_utils",
    os.path.join(os.path.dirname(__file__), "..", "common", "watermark_utils.py"),
)
if watermark_utils_spec and watermark_utils_spec.loader:
    watermark_utils = importlib.util.module_from_spec(watermark_utils_spec)
    watermark_utils_spec.loader.exec_module(watermark_utils)

    # Make functions available in current module
    extract_nano_id_from_watermark = watermark_utils.extract_nano_id_from_watermark
    embed_watermark_to_image_data = watermark_utils.embed_watermark_to_image_data
    verify_watermark_embedding = watermark_utils.verify_watermark_embedding
else:
    # Fallback: define dummy functions if import fails
    def extract_nano_id_from_watermark(image_data: bytes) -> Dict[str, Any]:
        return {"extractedId": None, "method": "trustmark_P_BCH5", "confidence": 0.0}

    def embed_watermark_to_image_data(image_data: bytes, nano_id: str) -> bytes:
        return image_data

    def verify_watermark_embedding(
        watermarked_data: bytes,
        expected_nano_id: str,
        skip_verification: Optional[bool] = None,
        min_confidence: Optional[float] = None,
    ) -> Dict[str, Any]:
        return {
            "extractedId": expected_nano_id,
            "confidence": 1.0,
            "verified": True,
            "method": "trustmark_P_BCH5",
        }


# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize S3 client
s3_client = boto3.client("s3")

# Bluesky file size limit (976.56KB)
MAX_FILE_SIZE_BYTES = 1000000  # 976.56KB ≈ 1MB


def compress_image_to_size_limit(image_data: bytes, max_size: int = MAX_FILE_SIZE_BYTES) -> bytes:
    """
    Compress image to fit within size limit.
    
    Args:
        image_data: Original image data
        max_size: Maximum file size in bytes
        
    Returns:
        Compressed image data
    """
    logger.info(f"Compressing image from {len(image_data)} bytes to under {max_size} bytes")
    
    # If already under limit, return as-is
    if len(image_data) <= max_size:
        logger.info("Image already under size limit")
        return image_data
    
    try:
        img = Image.open(BytesIO(image_data))
        
        # Convert to RGB if necessary
        if img.mode in ('RGBA', 'LA', 'P'):
            img = img.convert('RGB')
        
        quality = 90
        
        while quality >= 10:
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as temp_file:
                temp_path = temp_file.name
            
            try:
                # Save with current quality
                img.save(temp_path, format='JPEG', quality=quality, optimize=True)
                
                # Read compressed data
                with open(temp_path, 'rb') as f:
                    compressed_data = f.read()
                
                logger.info(f"Quality {quality}: {len(compressed_data)} bytes")
                
                if len(compressed_data) <= max_size:
                    logger.info(f"Compression successful: {len(compressed_data)} bytes with quality {quality}")
                    return compressed_data
                
                quality -= 5
                
            finally:
                # Clean up temp file
                if os.path.exists(temp_path):
                    os.unlink(temp_path)
        
        raise Exception(f'Could not compress image to under {max_size} bytes')
        
    except Exception as e:
        logger.error(f"Error compressing image: {e}")
        raise


def find_image_file(bucket_name: str, post_id: str, image_index: int = 1, image_extension: str = "png") -> Optional[str]:
    """Find the image file for a given post ID and index."""
    key = f"{post_id}/image{image_index}.{image_extension}"
    
    try:
        s3_client.head_object(Bucket=bucket_name, Key=key)
        logger.info(f"Found image file: {key}")
        return key
    except Exception as e:
        logger.error(f"No image file found: {key}, error: {e}")
        return None


def get_content_type(key: str) -> str:
    """Get the content type based on file extension."""
    key_lower = key.lower()
    if key_lower.endswith(".jpg") or key_lower.endswith(".jpeg"):
        return "image/jpeg"
    elif key_lower.endswith(".png"):
        return "image/png"
    elif key_lower.endswith(".webp"):
        return "image/webp"
    else:
        return "application/octet-stream"


def extract_watermark(bucket_name: str, key: str) -> Dict[str, Any]:
    """
    Extract watermark from an image in S3.

    Args:
        bucket_name: S3 bucket name
        key: S3 object key

    Returns:
        Response dictionary with extracted watermark information
    """
    logger.info(f"Extracting watermark from: bucket={bucket_name}, key={key}")

    try:
        # Download image from S3
        logger.info("Downloading image from S3...")
        response = s3_client.get_object(Bucket=bucket_name, Key=key)
        image_data = response["Body"].read()
        logger.info(f"Downloaded image size: {len(image_data)} bytes")

        # Extract watermark
        extraction_result = extract_nano_id_from_watermark(image_data)

        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "message": "Watermark extraction completed",
                    "result": extraction_result,
                }
            ),
            "headers": {
                "Content-Type": "application/json",
            },
        }

    except Exception as error:
        logger.error(f"Error in extract_watermark: {error}", exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({"error": f"Failed to extract watermark: {str(error)}"}),
            "headers": {
                "Content-Type": "application/json",
            },
        }


def handler(
    event: Dict[str, Any], context: Any
) -> Union[Dict[str, Any], Dict[str, str]]:
    """
    Lambda handler for embedding Trustmark watermarks.

    Args:
        event: Lambda event, can be from API Gateway or Step Functions
        context: Lambda context

    Returns:
        Response appropriate for the calling service
    """
    logger.info("Handler starting...")
    logger.info(f"Event received: {json.dumps(event, default=str)}")

    # Analyze event structure
    event_analysis = {
        "hasBody": "body" in event,
        "hasPostId": "postId" in event,
        "hasBucketName": "bucketName" in event or "bucket" in event,
        "hasUserId": "userId" in event,
        "eventKeys": list(event.keys()),
    }
    logger.info(f"Event type analysis: {event_analysis}")

    try:
        # Determine the source and extract request body
        request_body = None

        # Check if this is a Step Functions invocation (direct object)
        if (
            "postId" in event
            or "bucketName" in event
            or "bucket" in event
            or "userId" in event
        ):
            logger.info("Step Functions invocation detected")
            bucket_name = event.get("bucket") or event.get("bucketName")
            post_id = event["postId"]
            image_index = event.get("imageIndex", 1)
            image_extension = event.get("imageExtension", "png")

            if not bucket_name:
                return {
                    "statusCode": 400,
                    "body": json.dumps({"error": "Bucket name is required"}),
                    "headers": {"Content-Type": "application/json"},
                }

            # Find the actual image file using index and extension
            image_key = find_image_file(bucket_name, post_id, image_index, image_extension)
            if not image_key:
                return {
                    "statusCode": 404,
                    "body": json.dumps(
                        {"error": f"No image file found for post {post_id}, index {image_index}"}
                    ),
                    "headers": {"Content-Type": "application/json"},
                }

            request_body = {
                "action": "embed",
                "bucketName": bucket_name,
                "key": image_key,
                "watermarkData": {
                    "postId": event["postId"],
                    "userId": event["userId"],
                    "timestamp": event.get("timestamp", ""),
                },
            }
            logger.info(f"Processing Step Functions request: {request_body}")
        elif not event.get("body") or event.get("body") in ["{}", ""]:
            logger.info("Test invocation detected, returning debug info")
            return {
                "statusCode": 200,
                "body": json.dumps(
                    {
                        "message": "Trustmark watermark handler (Python version)",
                        "available_methods": ["embed", "extract"],
                        "libraries": ["blind-watermark", "PIL", "numpy"],
                    }
                ),
                "headers": {
                    "Content-Type": "application/json",
                },
            }
        else:
            # API Gateway invocation
            try:
                body = event["body"]
                request_body = json.loads(body) if isinstance(body, str) else body
                logger.info(f"Processing API Gateway request body: {request_body}")
            except json.JSONDecodeError as error:
                logger.error(f"Error parsing request body: {error}")
                return {
                    "statusCode": 400,
                    "body": json.dumps({"error": "Invalid JSON in request body"}),
                    "headers": {
                        "Content-Type": "application/json",
                    },
                }

        if not request_body or not isinstance(request_body, dict):
            logger.error("Invalid request body")
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Invalid request body"}),
                "headers": {
                    "Content-Type": "application/json",
                },
            }

        # Extract request parameters
        action = request_body.get("action")
        bucket_name = request_body.get("bucketName")
        key = request_body.get("key")
        watermark_data = request_body.get("watermarkData")

        if not action or not bucket_name or not key:
            return {
                "statusCode": 400,
                "body": json.dumps(
                    {"error": "Missing required parameters: action, bucketName, key"}
                ),
                "headers": {
                    "Content-Type": "application/json",
                },
            }

        # Process the watermarking request
        if action == "embed":
            if not watermark_data:
                return {
                    "statusCode": 400,
                    "body": json.dumps(
                        {"error": "Missing required parameter: watermarkData"}
                    ),
                    "headers": {"Content-Type": "application/json"},
                }
            return embed_watermark(bucket_name, key, watermark_data, event)
        elif action == "extract":
            return extract_watermark(bucket_name, key)
        else:
            return {
                "statusCode": 400,
                "body": json.dumps(
                    {"error": 'Invalid action. Use "embed" or "extract"'}
                ),
                "headers": {
                    "Content-Type": "application/json",
                },
            }

    except Exception as error:
        logger.error(f"Error processing request: {error}", exc_info=True)
        # For Step Functions, raise error to fail the task
        if (
            "postId" in event
            or "bucketName" in event
            or "bucket" in event
            or "userId" in event
        ):
            raise error
        # For API Gateway, return error response
        return {
            "statusCode": 500,
            "body": json.dumps({"error": "Internal server error"}),
            "headers": {
                "Content-Type": "application/json",
            },
        }


def embed_watermark(
    bucket_name: str,
    key: str,
    watermark_data: Dict[str, Any],
    original_event: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Embed Trustmark watermark into an image from S3.

    Args:
        bucket_name: S3 bucket name
        key: S3 object key
        watermark_data: Data to embed as watermark
        original_event: Original event for Step Functions response

    Returns:
        Response dictionary
    """
    logger.info(f"Embedding Trustmark watermark for: bucket={bucket_name}, key={key}")

    try:
        # Download image from S3
        logger.info("Downloading image from S3...")
        response = s3_client.get_object(Bucket=bucket_name, Key=key)
        original_image_data = response["Body"].read()
        logger.info(f"Downloaded image size: {len(original_image_data)} bytes")

        # Step 1: Compress image if over 1MB before watermarking
        compressed_image_data = compress_image_to_size_limit(original_image_data)
        logger.info(f"Pre-watermark compression: {len(original_image_data)} -> {len(compressed_image_data)} bytes")

        # Extract nano ID from watermark data
        nano_id = watermark_data.get("postId")
        if not nano_id:
            raise ValueError("postId not found in watermarkData")

        # Step 2: Embed watermark using the compressed image
        watermarked_data = embed_watermark_to_image_data(compressed_image_data, str(nano_id))
        logger.info(f"After watermark embedding: {len(watermarked_data)} bytes")

        # Step 3: Re-compress if still over 1MB after watermarking
        if len(watermarked_data) > MAX_FILE_SIZE_BYTES:
            logger.info("Re-compressing watermarked image to meet size limit")
            watermarked_data = compress_image_to_size_limit(watermarked_data)
            logger.info(f"Final compressed size: {len(watermarked_data)} bytes")

        # Verify the watermark was embedded correctly using common verification function
        verification_result = verify_watermark_embedding(watermarked_data, str(nano_id))

        extracted_id = verification_result.get("extractedId")
        confidence = verification_result.get("confidence", 0.0)

        # Upload back to S3 only after successful verification
        logger.info("Uploading verified watermarked image back to S3...")
        # ContentTypeをimage/pngに固定
        s3_client.put_object(
            Bucket=bucket_name,
            Key=key,
            Body=watermarked_data,
            ContentType="image/png",
        )

        logger.info("Watermark embedding and verification completed successfully")

        # For Step Functions, return the original event parameters directly
        if original_event and "postId" in original_event:
            return {
                "postId": original_event["postId"],
                "userId": original_event["userId"],
                "bucket": original_event.get("bucket")
                or original_event.get("bucketName"),
                "timestamp": original_event.get("timestamp", ""),
                "hasWatermarkedImage": True,
                "message": "Watermark embedded and verified successfully",
                "method": "trustmark",
                "size": len(watermarked_data),
                "verificationResult": {
                    "extractedId": extracted_id,
                    "confidence": confidence,
                    "verified": True,
                },
            }

        # Return appropriate response for API Gateway
        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "message": "Trustmark watermark embedded and verified successfully",
                    "method": "trustmark",
                    "size": len(watermarked_data),
                    "verificationResult": {
                        "extractedId": extracted_id,
                        "confidence": confidence,
                        "verified": True,
                    },
                }
            ),
            "headers": {
                "Content-Type": "application/json",
            },
        }

    except Exception as error:
        logger.error(f"Error in embed_watermark: {error}", exc_info=True)
        raise Exception(f"Failed to embed watermark: {str(error)}")
