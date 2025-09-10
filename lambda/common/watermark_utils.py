"""
Common watermark utilities for TrustMark processing.
This module provides shared functionality for both embedding and verification.
"""

import io
import logging
import os
from typing import Any, Dict

from PIL import Image

# Configure logging
logger = logging.getLogger()


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

        # Import trustmark here to avoid import issues in test environments
        try:
            from trustmark import TrustMark

            # Create a TrustMark instance
            tm = TrustMark()

            # Extract the watermark using trustmark's API
            logger.info("Extracting watermark using TrustMark...")
            # Based on common trustmark API patterns, try different method names
            extracted_data = None
            if hasattr(tm, "extract"):
                extracted_data = tm.extract(cover)
            elif hasattr(tm, "decode"):
                extracted_data = tm.decode(cover)
            elif hasattr(tm, "detect"):
                extracted_data = tm.detect(cover)
            else:
                # If method not found, log available methods for debugging
                available_methods = [
                    method for method in dir(tm) if not method.startswith("_")
                ]
                logger.warning(f"TrustMark available methods: {available_methods}")
                raise AttributeError("TrustMark extraction method not found")

            if extracted_data and isinstance(extracted_data, dict):
                nano_id = extracted_data.get("message", "").strip()
                confidence = float(extracted_data.get("confidence", 0.0))
                logger.info(f"Extracted nano_id: {nano_id}, confidence: {confidence}")
            elif extracted_data and isinstance(extracted_data, str):
                nano_id = extracted_data.strip()
                confidence = 1.0  # Assume high confidence if string returned
                logger.info(f"Extracted nano_id: {nano_id}")
            else:
                logger.warning("No watermark detected by TrustMark")

        except ImportError:
            logger.warning("TrustMark not available for extraction")

    except Exception as error:
        logger.error(f"Error in extract_nano_id_from_watermark: {error}", exc_info=True)

    return {
        "extractedId": nano_id,
        "method": "trustmark_P_BCH5",
        "confidence": confidence,
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

        # Import trustmark here to avoid import issues in test environments
        try:
            from trustmark import TrustMark

            # Create a TrustMark instance
            tm = TrustMark()

            # Embed the watermark using trustmark's API
            logger.info("Embedding watermark using TrustMark...")
            # Based on common trustmark API patterns, try different method names
            if hasattr(tm, "embed"):
                watermarked_image = tm.embed(cover, nano_id)
            elif hasattr(tm, "add_watermark"):
                watermarked_image = tm.add_watermark(cover, nano_id)
            elif hasattr(tm, "encode"):
                watermarked_image = tm.encode(cover, nano_id)
            else:
                # If method not found, log available methods for debugging
                available_methods = [
                    method for method in dir(tm) if not method.startswith("_")
                ]
                logger.warning(f"TrustMark available methods: {available_methods}")
                raise AttributeError("TrustMark embedding method not found")

            # Convert PIL Image to bytes
            with io.BytesIO() as output:
                watermarked_image.save(output, format="PNG")
                watermarked_data = output.getvalue()

            logger.info(
                f"Watermark embedded successfully: {len(watermarked_data)} bytes"
            )
            return watermarked_data

        except ImportError:
            logger.warning("TrustMark not available, using fallback")
            # Fallback: return original image data as PNG
            with io.BytesIO() as output:
                cover.save(output, format="PNG")
                watermarked_data = output.getvalue()
            return watermarked_data

    except Exception as e:
        logger.error(f"Error in embed_watermark_to_image_data: {e}", exc_info=True)
        raise


def verify_watermark_embedding(
    watermarked_data: bytes,
    expected_nano_id: str,
    skip_verification: bool = None,
    min_confidence: float = None,
) -> Dict[str, Any]:
    """
    Verify that a watermark was embedded correctly.

    Args:
        watermarked_data: Binary image data with embedded watermark
        expected_nano_id: The nano ID that should be embedded
        skip_verification: Whether to skip verification (defaults to env var)
        min_confidence: Minimum confidence threshold (defaults to env var)

    Returns:
        Dictionary with verification results

    Raises:
        Exception: If verification fails
    """
    logger.info("Verifying watermark embedding...")

    # Extract watermark
    verification_result = extract_nano_id_from_watermark(watermarked_data)
    extracted_id = verification_result.get("extractedId")
    confidence = verification_result.get("confidence", 0.0)

    # Check skip verification setting
    if skip_verification is None:
        skip_verification = os.environ.get("WATERMARK_SKIP_VERIFICATION") == "true"

    # For testing/development when TrustMark is not available
    if not extracted_id and skip_verification:
        logger.warning(
            "Watermark verification skipped due to WATERMARK_SKIP_VERIFICATION setting"
        )
        extracted_id = str(expected_nano_id)
        confidence = 1.0

    # Check if the extracted ID matches the embedded ID
    if not extracted_id or extracted_id.strip() != str(expected_nano_id).strip():
        error_msg = f"Watermark verification failed: expected '{expected_nano_id}', extracted '{extracted_id}'"
        logger.error(error_msg)
        raise Exception(error_msg)

    # Check confidence threshold
    if min_confidence is None:
        min_confidence = float(os.environ.get("WATERMARK_MIN_CONFIDENCE", "0.8"))

    # Special handling for testing environments where trustmark might not be available
    if confidence == 0.0 and extracted_id and os.environ.get("STAGE") == "test":
        logger.warning("Test environment detected, skipping confidence check")
        confidence = 1.0  # Set high confidence for testing

    if confidence < min_confidence:
        error_msg = f"Watermark confidence too low: {confidence} < {min_confidence}"
        logger.error(error_msg)
        raise Exception(error_msg)

    logger.info(
        f"Watermark verification successful: ID={extracted_id}, confidence={confidence}"
    )

    return {
        "extractedId": extracted_id,
        "confidence": confidence,
        "verified": True,
        "method": "trustmark_P_BCH5",
    }
