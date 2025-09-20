import base64
import json
import logging
import os
import time
import uuid
from typing import Any, Dict, Optional

import boto3

APP_NAME = os.environ.get("APP_NAME", "brw")
DOMAIN_NAME = os.environ.get("DOMAIN_NAME", "brw-example.app")
CLOUDFRONT_DOMAIN = os.environ.get("CLOUDFRONT_DOMAIN", "")
VERIFICATION_RESULTS_TABLE = os.environ.get("VERIFICATION_RESULTS_TABLE", "")

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3")
dynamodb_client = boto3.client("dynamodb")

def get_json_response(data: Dict[str, Any], status_code: int = 200) -> Dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
        "body": json.dumps(data),
    }

def save_verification_result(
    verification_id: str,
    status: str,
    result_data: Optional[Dict] = None,
    error_message: Optional[str] = None,
):
    try:
        item = {
            "verification_id": {"S": verification_id},
            "status": {"S": status},
            "timestamp": {"N": str(int(time.time()))},
            "ttl": {"N": str(int(time.time()) + 86400)},
        }

        if result_data:
            item["result_data"] = {"S": json.dumps(result_data)}

        if error_message:
            item["error_message"] = {"S": error_message}

        dynamodb_client.put_item(TableName=VERIFICATION_RESULTS_TABLE, Item=item)
        logger.info(f"Successfully saved verification result for ID: {verification_id}")
    except Exception as e:
        logger.error(f"Failed to save verification result: {e}")

def extract_image_from_multipart(body: bytes, content_type: str) -> Optional[bytes]:
    try:
        boundary = content_type.split("boundary=")[1]
        if not boundary:
            return None

        body_string = body.decode("utf-8") if isinstance(body, bytes) else str(body)
        parts = body_string.split(f"--{boundary}")

        for i in range(1, len(parts) - 1):
            part = parts[i]
            header_end_index = part.find("\\r\\n\\r\\n")
            if header_end_index == -1:
                continue

            headers = part[:header_end_index]
            content = part[header_end_index + 4:]

            if 'name="image"' in headers and "Content-Type: image/" in headers:
                content_bytes = content.encode("latin-1")
                if len(content_bytes) >= 2 and content_bytes[-2:] == b"\\r\\n":
                    content_bytes = content_bytes[:-2]
                return content_bytes

        return None
    except Exception as error:
        logger.error("Error extracting image from multipart: %s", error)
        return None

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    logger.info("Verify watermark API handler starting...")
    
    try:
        http_method = event.get("httpMethod", "GET")

        if http_method == "OPTIONS":
            return get_json_response({})

        if http_method == "GET":
            return get_json_response({
                "title": f"{APP_NAME} - 透かしの確認",
                "description": "アップロードした画像の透かしから来歴情報を探します",
                "endpoints": {
                    "upload": "/api/verify-watermark",
                    "checkResult": "/api/check-result"
                },
                "supportedFormats": ["JPEG", "PNG", "WebP"]
            })

        elif http_method == "POST":
            content_type = event.get("headers", {}).get("content-type") or event.get("headers", {}).get("Content-Type", "")

            if not content_type or "multipart/form-data" not in content_type:
                return get_json_response({"error": "無効なリクエスト形式です。"}, 400)

            raw_body = event.get("body", "")
            
            if event.get("isBase64Encoded", False):
                body = base64.b64decode(raw_body)
            else:
                body = raw_body.encode("iso-8859-1") if isinstance(raw_body, str) else raw_body

            image_data = extract_image_from_multipart(body, content_type)

            if not image_data:
                return get_json_response({"error": "画像データが見つかりませんでした。"}, 400)

            verification_id = str(uuid.uuid4())
            save_verification_result(verification_id, "started")

            # Return immediate response for async processing
            response_data = {
                "verification_id": verification_id,
                "status": "processing",
                "message": "透かし検証を開始しました。結果確認はcheck-resultエンドポイントをご利用ください。",
                "check_url": f"https://{DOMAIN_NAME}/check-result?id={verification_id}",
            }

            return get_json_response(response_data)

        else:
            return get_json_response({"error": "サポートされていないHTTPメソッドです。"}, 405)

    except Exception as error:
        logger.error("Error in verify watermark handler: %s", error)
        return get_json_response({"error": "内部サーバーエラーが発生しました。"}, 500)