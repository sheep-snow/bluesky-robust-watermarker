import io
import json
import logging
import os
import tempfile
from typing import Any, Dict, Optional, Union

import boto3
from PIL import Image
from trustmark import TrustMark

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize S3 client
s3_client = boto3.client("s3")


def find_image_file(bucket_name: str, post_id: str) -> Optional[str]:
    """Find the image file for a given post ID, supporting both jpg and png formats."""
    possible_keys = [
        f"{post_id}/image.jpg",
        f"{post_id}/image.jpeg",
        f"{post_id}/image.png",
    ]

    for key in possible_keys:
        try:
            s3_client.head_object(Bucket=bucket_name, Key=key)
            logger.info(f"Found image file: {key}")
            return key
        except Exception:
            continue

    logger.error(f"No image file found for post {post_id}")
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

            if not bucket_name:
                return {
                    "statusCode": 400,
                    "body": json.dumps({"error": "Bucket name is required"}),
                    "headers": {"Content-Type": "application/json"},
                }

            # Find the actual image file (jpg or png)
            image_key = find_image_file(bucket_name, post_id)
            if not image_key:
                return {
                    "statusCode": 404,
                    "body": json.dumps(
                        {"error": f"No image file found for post {post_id}"}
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
            return embed_spectrum_watermark(bucket_name, key, watermark_data, event)
        elif action == "extract":
            return extract_spectrum_watermark(bucket_name, key)
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


def embed_watermark_to_image_data(image_data: bytes, nano_id: str) -> bytes:
    """
    Embeds a nanoid as a watermark into image data using trustmark.

    Args:
        image_data: Binary image data.
        nano_id: The nanoid to embed.

    Returns:
        Binary image data with the watermark embedded.
    """
    logger.info(f"Embedding watermark into image data of size: {len(image_data)} bytes")
    logger.info(f"nanoid to embed: {nano_id}")

    try:
        # Load image from bytes
        cover = Image.open(io.BytesIO(image_data)).convert("RGB")

        # Initialize TrustMark with BCH_5 encoding for nanoid (8 characters)
        tm = TrustMark(verbose=False, model_type="P", encoding_type=1)

        # nanoidを直接使用（BCH_5の8文字制限内）
        encoded_id = nano_id
        logger.info(f"Using nanoid {nano_id} for watermark")

        # Embed watermark
        watermarked_image = tm.encode(cover, encoded_id)

        # Convert back to bytes
        with io.BytesIO() as output:
            watermarked_image.save(output, format="PNG")
            watermarked_data = output.getvalue()

        logger.info(f"Watermarked image size: {len(watermarked_data)} bytes")
        return watermarked_data

    except Exception as e:
        logger.error(f"Error in embed_watermark_to_image_data: {e}", exc_info=True)
        raise


def embed_spectrum_watermark(
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
        image_data = response["Body"].read()
        logger.info(f"Downloaded image size: {len(image_data)} bytes")

        # Extract nano ID from watermark data
        nano_id = watermark_data.get("postId")
        if not nano_id:
            raise ValueError("postId not found in watermarkData")

        # Embed watermark using the separated function
        watermarked_data = embed_watermark_to_image_data(image_data, str(nano_id))

        # Upload back to S3
        logger.info("Uploading watermarked image back to S3...")
        # ContentTypeをimage/pngに固定
        s3_client.put_object(
            Bucket=bucket_name,
            Key=key,
            Body=watermarked_data,
            ContentType="image/png",
        )

        logger.info("Watermark embedding completed successfully")

        # For Step Functions, return the original event parameters directly
        if original_event and "postId" in original_event:
            return {
                "postId": original_event["postId"],
                "userId": original_event["userId"],
                "bucket": original_event.get("bucket")
                or original_event.get("bucketName"),
                "timestamp": original_event.get("timestamp", ""),
                "hasSpectrumWatermarkedImage": True,
                "message": "Watermark embedded successfully",
                "method": "trustmark",
                "size": len(watermarked_data),
            }

        # Return appropriate response for API Gateway
        return {
            "statusCode": 200,
            "body": json.dumps(
                {
                    "message": "Trustmark watermark embedded successfully",
                    "method": "trustmark",
                    "size": len(watermarked_data),
                }
            ),
            "headers": {
                "Content-Type": "application/json",
            },
        }

    except Exception as error:
        logger.error(f"Error in embed_spectrum_watermark: {error}", exc_info=True)
        raise Exception(f"Failed to embed watermark: {str(error)}")


def extract_nano_id_from_watermark(image_data: bytes) -> Dict[str, Any]:
    """
    Extract Nano ID from watermarked image using trustmark.

    Args:
        image_data: Binary image data

    Returns:
        Dictionary with extracted ID, method, and confidence
    """
    logger.info(
        f"Extracting Nano ID from watermark, image size: {len(image_data)} bytes"
    )
    nano_id = None
    confidence = 0.0

    try:
        # Load image from bytes
        cover = Image.open(io.BytesIO(image_data)).convert("RGB")

        # Initialize TrustMark with BCH_5 encoding for nanoid (8 characters)
        tm = TrustMark(verbose=False, model_type="P", encoding_type=1)

        # Decode watermark
        wm_secret, wm_present, wm_schema = tm.decode(cover)

        if wm_present and wm_secret:
            extracted_secret = wm_secret.strip()

            nano_id = extracted_secret

            confidence = 0.95  # High confidence
            logger.info(f"Successfully extracted nanoid: {nano_id}")
        else:
            logger.warning("No watermark detected or extracted text is empty")

    except Exception as error:
        logger.error(f"Error in extract_nano_id_from_watermark: {error}", exc_info=True)

    return {
        "extractedId": nano_id,
        "method": "trustmark_P_BCH5",
        "confidence": confidence,
    }
