import json
import logging
import os
from typing import Any, Dict, Optional

import boto3

# 環境変数から設定を取得
APP_NAME = os.environ.get("APP_NAME", "brw")
DOMAIN_NAME = os.environ.get("DOMAIN_NAME", "brw-example.app")
VERIFICATION_RESULTS_TABLE = os.environ.get("VERIFICATION_RESULTS_TABLE", "")

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb_client = boto3.client("dynamodb")


def get_json_response(data: Dict[str, Any], status_code: int = 200) -> Dict[str, Any]:
    """Return a JSON response for API Gateway."""
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
            "Access-Control-Allow-Headers": "Content-Type",
        },
        "body": json.dumps(data),
    }


def get_html_response(html_content: str) -> Dict[str, Any]:
    """Return an HTML response for API Gateway."""
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET",
            "Access-Control-Allow-Headers": "Content-Type",
        },
        "body": html_content,
    }


def get_verification_result(verification_id: str) -> Optional[Dict]:
    """Get verification result from DynamoDB."""
    try:
        response = dynamodb_client.get_item(
            TableName=VERIFICATION_RESULTS_TABLE,
            Key={"verification_id": {"S": verification_id}},
        )

        if "Item" not in response:
            return None

        item = response["Item"]
        result = {
            "verification_id": item["verification_id"]["S"],
            "status": item["status"]["S"],
            "timestamp": int(item["timestamp"]["N"]),
        }

        if "result_data" in item:
            result["result_data"] = json.loads(item["result_data"]["S"])

        if "error_message" in item:
            result["error_message"] = item["error_message"]["S"]

        return result

    except Exception as e:
        logger.error(f"Failed to get verification result: {e}")
        return None


def generate_result_page_html(verification_id: str, result: Dict) -> str:
    """Generate HTML page for showing verification result."""

    if result["status"] == "processing":
        return f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>透かし検証中 - {APP_NAME}</title>
    <style>
        body {{ font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }}
        .container {{ text-align: center; }}
        .status {{ color: #2196F3; font-size: 1.2em; margin: 20px 0; }}
        .loading {{ display: inline-block; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #2196F3; border-radius: 50%; animation: spin 1s linear infinite; }}
        @keyframes spin {{ 0% {{ transform: rotate(0deg); }} 100% {{ transform: rotate(360deg); }} }}
        .refresh-btn {{ background: #2196F3; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin: 10px; }}
    </style>
    <script>
        setTimeout(() => {{ location.reload(); }}, 5000);
    </script>
</head>
<body>
    <div class="container">
        <h1>透かし検証中</h1>
        <div class="loading"></div>
        <div class="status">画像を解析しています...</div>
        <p>検証ID: {verification_id}</p>
        <p>この画面は5秒後に自動更新されます。</p>
        <button class="refresh-btn" onclick="location.reload()">手動更新</button>
    </div>
</body>
</html>"""

    elif result["status"] == "completed":
        result_data = result.get("result_data", {})

        if result_data.get("has_watermark"):
            extracted_id = result_data.get("extracted_id", "N/A")
            has_provenance = result_data.get("has_provenance", False)

            if has_provenance:
                provenance_url = result_data.get("provenance_url", "")
                return f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>透かし検証完了 - {APP_NAME}</title>
    <style>
        body {{ font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }}
        .container {{ text-align: center; }}
        .success {{ color: #4CAF50; font-size: 1.2em; margin: 20px 0; }}
        .provenance-btn {{ background: #4CAF50; color: white; padding: 15px 30px; border: none; border-radius: 5px; cursor: pointer; margin: 10px; text-decoration: none; display: inline-block; }}
        .back-btn {{ background: #2196F3; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin: 10px; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>✅ 透かしが見つかりました</h1>
        <div class="success">この画像には {APP_NAME} の透かしが埋め込まれています</div>
        <p>透かしID: {extracted_id}</p>
        <p>来歴情報が利用可能です。</p>
        <a href="{provenance_url}" class="provenance-btn">来歴情報を確認</a>
        <br>
        <button class="back-btn" onclick="history.back()">別の画像を試す</button>
    </div>
</body>
</html>"""
            else:
                return f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>透かし検証完了 - {APP_NAME}</title>
    <style>
        body {{ font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }}
        .container {{ text-align: center; }}
        .warning {{ color: #FF9800; font-size: 1.2em; margin: 20px 0; }}
        .back-btn {{ background: #2196F3; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin: 10px; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>⚠️ 透かしは見つかりましたが...</h1>
        <div class="warning">この透かしに対応する来歴情報が見つかりませんでした</div>
        <p>透かしID: {extracted_id}</p>
        <button class="back-btn" onclick="history.back()">別の画像を試す</button>
    </div>
</body>
</html>"""
        else:
            return f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>透かし検証完了 - {APP_NAME}</title>
    <style>
        body {{ font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }}
        .container {{ text-align: center; }}
        .error {{ color: #f44336; font-size: 1.2em; margin: 20px 0; }}
        .back-btn {{ background: #2196F3; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin: 10px; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>❌ 透かしが見つかりません</h1>
        <div class="error">この画像には {APP_NAME} の透かしが埋め込まれていません</div>
        <p>この画像は {APP_NAME} で生成されていない可能性があります。</p>
        <button class="back-btn" onclick="history.back()">別の画像を試す</button>
    </div>
</body>
</html>"""

    elif result["status"] == "error":
        error_message = result.get("error_message", "不明なエラー")
        return f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>検証エラー - {APP_NAME}</title>
    <style>
        body {{ font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }}
        .container {{ text-align: center; }}
        .error {{ color: #f44336; font-size: 1.2em; margin: 20px 0; }}
        .back-btn {{ background: #2196F3; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin: 10px; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>⚠️ 検証中にエラーが発生しました</h1>
        <div class="error">エラー詳細: {error_message}</div>
        <p>検証ID: {verification_id}</p>
        <button class="back-btn" onclick="history.back()">別の画像を試す</button>
    </div>
</body>
</html>"""

    else:
        return f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>不明なステータス - {APP_NAME}</title>
    <style>
        body {{ font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }}
        .container {{ text-align: center; }}
        .error {{ color: #f44336; font-size: 1.2em; margin: 20px 0; }}
        .back-btn {{ background: #2196F3; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin: 10px; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>⚠️ 不明なステータス</h1>
        <div class="error">ステータス: {result["status"]}</div>
        <p>検証ID: {verification_id}</p>
        <button class="back-btn" onclick="history.back()">別の画像を試す</button>
    </div>
</body>
</html>"""


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for checking verification results.
    """
    logger.info("Check result handler starting...")
    logger.info("Event received: %s", json.dumps(event, default=str))

    try:
        # Get HTTP method
        http_method = event.get("httpMethod", "GET")

        if http_method == "GET":
            # Get verification ID from query parameters
            query_params = event.get("queryStringParameters") or {}
            verification_id = query_params.get("verification_id") or query_params.get(
                "id"
            )

            if not verification_id:
                return get_json_response(
                    {"error": "verification_id parameter is required"}, 400
                )

            # Get result from DynamoDB
            result = get_verification_result(verification_id)

            if not result:
                return get_json_response({"error": "Verification ID not found"}, 404)

            # Check if request wants JSON response
            accept_header = event.get("headers", {}).get("accept") or event.get(
                "headers", {}
            ).get("Accept", "")

            if "application/json" in accept_header:
                return get_json_response(result)
            else:
                # Return HTML page
                html_content = generate_result_page_html(verification_id, result)
                return get_html_response(html_content)

        elif http_method == "OPTIONS":
            # Handle CORS preflight
            return {
                "statusCode": 200,
                "headers": {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Accept",
                },
                "body": "",
            }

        else:
            return get_json_response({"error": "Method not allowed"}, 405)

    except Exception as error:
        logger.error("Error in check result handler: %s", error, exc_info=True)
        return get_json_response({"error": "Internal server error"}, 500)
