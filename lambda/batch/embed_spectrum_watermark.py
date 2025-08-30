import json
import logging
import os
import tempfile
from typing import Any, Dict, Optional, Union

import boto3
from blind_watermark import WaterMark

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
    Lambda handler for embedding spread spectrum watermarks.

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
                        "message": "Spread spectrum watermark handler (Python version)",
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


def embed_spectrum_watermark(
    bucket_name: str,
    key: str,
    watermark_data: Dict[str, Any],
    original_event: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Embed spread spectrum watermark into an image.

    Args:
        bucket_name: S3 bucket name
        key: S3 object key
        watermark_data: Data to embed as watermark
        original_event: Original event for Step Functions response

    Returns:
        Response dictionary
    """
    logger.info(
        f"Embedding spread spectrum watermark for: bucket={bucket_name}, key={key}"
    )

    try:
        # Download image from S3
        logger.info("Downloading image from S3...")
        response = s3_client.get_object(Bucket=bucket_name, Key=key)
        image_data = response["Body"].read()
        logger.info(f"Downloaded image size: {len(image_data)} bytes")

        # Convert watermark data to string for embedding
        watermark_text = json.dumps(watermark_data, separators=(",", ":"))
        logger.info(f"Watermark text to embed: {watermark_text}")

        # Create temporary files
        with (
            tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as input_file,
            tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as output_file,
        ):
            try:
                # Write original image to temporary file
                input_file.write(image_data)
                input_file.flush()
                input_path = input_file.name
                output_path = output_file.name

                logger.info(f"Processing image: {input_path} -> {output_path}")

                # Initialize blind watermark
                bwm = WaterMark(password_img=1, password_wm=1)

                # Embed watermark
                logger.info("Embedding watermark using blind-watermark library...")
                bwm.read_img(input_path)
                bwm.read_wm(watermark_text, mode="str")
                bwm.embed(output_path)

                # Read the watermarked image
                with open(output_path, "rb") as f:
                    watermarked_data = f.read()

                logger.info(f"Watermarked image size: {len(watermarked_data)} bytes")

                # Upload back to S3
                logger.info("Uploading watermarked image back to S3...")
                s3_client.put_object(
                    Bucket=bucket_name,
                    Key=key,
                    Body=watermarked_data,
                    ContentType=get_content_type(key),
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
                        "message": "Spread spectrum watermark embedded successfully (Python)",
                        "method": "spread_spectrum_python",
                        "size": len(watermarked_data),
                    }

                # Return appropriate response for API Gateway
                return {
                    "statusCode": 200,
                    "body": json.dumps(
                        {
                            "message": "Spread spectrum watermark embedded successfully (Python)",
                            "method": "spread_spectrum_python",
                            "size": len(watermarked_data),
                        }
                    ),
                    "headers": {
                        "Content-Type": "application/json",
                    },
                }

            finally:
                # Clean up temporary files
                try:
                    os.unlink(input_path)
                    os.unlink(output_path)
                except OSError:
                    pass

    except Exception as error:
        logger.error(f"Error in embed_spectrum_watermark: {error}", exc_info=True)
        raise Exception(f"Failed to embed watermark: {str(error)}")


def extract_spectrum_watermark(bucket_name: str, key: str) -> Dict[str, Any]:
    """
    Extract spread spectrum watermark from an image.

    Args:
        bucket_name: S3 bucket name
        key: S3 object key

    Returns:
        Response dictionary with extracted watermark data
    """
    logger.info(
        f"Extracting spread spectrum watermark from: bucket={bucket_name}, key={key}"
    )

    try:
        # Download image from S3
        logger.info("Downloading image from S3...")
        response = s3_client.get_object(Bucket=bucket_name, Key=key)
        image_data = response["Body"].read()
        logger.info(f"Downloaded image size: {len(image_data)} bytes")

        # Create temporary file
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as temp_file:
            try:
                # Write image to temporary file
                temp_file.write(image_data)
                temp_file.flush()
                temp_path = temp_file.name

                logger.info(f"Extracting watermark from: {temp_path}")

                # Initialize blind watermark for extraction
                bwm = WaterMark(password_img=1, password_wm=1)

                # Extract watermark
                logger.info("Extracting watermark using blind-watermark library...")
                extracted_text = bwm.extract(temp_path, wm_shape=1000, mode="str")

                # Try to parse the extracted text as JSON
                extracted_data = None
                try:
                    # Clean up the extracted text (remove null characters and whitespace)
                    cleaned_text = extracted_text.strip("\x00").strip()
                    if cleaned_text:
                        extracted_data = json.loads(cleaned_text)
                        logger.info(
                            f"Successfully extracted watermark data: {extracted_data}"
                        )
                    else:
                        logger.warning("Extracted text is empty after cleaning")
                except json.JSONDecodeError:
                    logger.warning(
                        f"Could not parse extracted text as JSON: {repr(extracted_text[:100])}"
                    )

                return {
                    "statusCode": 200,
                    "body": json.dumps(
                        {
                            "message": "Spread spectrum watermark extraction completed (Python)",
                            "method": "spread_spectrum_python",
                            "watermarkData": extracted_data,
                            "rawExtractedText": extracted_text[:500]
                            if extracted_text
                            else None,  # Truncate for safety
                        }
                    ),
                    "headers": {
                        "Content-Type": "application/json",
                    },
                }

            finally:
                # Clean up temporary file
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

    except Exception as error:
        logger.error(f"Error in extract_spectrum_watermark: {error}", exc_info=True)
        raise Exception(f"Failed to extract watermark: {str(error)}")


def extract_snowflake_id_from_watermark(image_data: bytes) -> Dict[str, Any]:
    """
    Extract Snowflake ID from watermarked image.

    Args:
        image_data: Binary image data

    Returns:
        Dictionary with extracted ID, method, and confidence
    """
    logger.info(
        f"Extracting Snowflake ID from watermark, image size: {len(image_data)} bytes"
    )

    try:
        # Create temporary file
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as temp_file:
            try:
                # Write image to temporary file
                temp_file.write(image_data)
                temp_file.flush()
                temp_path = temp_file.name

                logger.info(f"Extracting Snowflake ID from: {temp_path}")

                # Initialize blind watermark for extraction
                bwm = WaterMark(password_img=1, password_wm=1)

                # Extract watermark
                logger.info("Extracting watermark using blind-watermark library...")
                extracted_text = bwm.extract(temp_path, wm_shape=1000, mode="str")

                # Try to parse the extracted text as JSON and get postId
                snowflake_id = None
                confidence = 0.0

                try:
                    # Clean up the extracted text
                    cleaned_text = extracted_text.strip("\x00").strip()
                    if cleaned_text:
                        extracted_data = json.loads(cleaned_text)
                        if "postId" in extracted_data:
                            snowflake_id = str(extracted_data["postId"])
                            confidence = 0.95
                            logger.info(
                                f"Successfully extracted Snowflake ID: {snowflake_id}"
                            )
                        else:
                            logger.warning(
                                "No postId found in extracted watermark data"
                            )
                    else:
                        logger.warning("Extracted text is empty after cleaning")
                except json.JSONDecodeError:
                    logger.warning(
                        f"Could not parse extracted text as JSON: {repr(extracted_text[:100])}"
                    )

                return {
                    "extractedId": snowflake_id,
                    "method": "spread_spectrum_python",
                    "confidence": confidence,
                }

            finally:
                # Clean up temporary file
                try:
                    os.unlink(temp_path)
                except OSError:
                    pass

    except Exception as error:
        logger.error(
            f"Error in extract_snowflake_id_from_watermark: {error}", exc_info=True
        )
        raise Exception(f"Failed to extract Snowflake ID: {str(error)}")
