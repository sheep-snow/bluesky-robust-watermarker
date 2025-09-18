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
    """Generate HTML page for showing verification result using DaisyUI layout."""
    from lambda.common.ui_framework import wrapWithLayout

    if result["status"] == "processing":
        content = f"""
        <div class="hero bg-gradient-to-r from-primary to-secondary text-primary-content rounded-lg mb-8">
          <div class="hero-content text-center py-12">
            <div class="max-w-md">
              <h1 class="mb-5 text-4xl font-bold">🔍 透かし検証中</h1>
              <p class="mb-5 text-lg">画像を解析しています...</p>
            </div>
          </div>
        </div>
        
        <div class="card bg-base-100 shadow-xl">
          <div class="card-body text-center">
            <div class="flex justify-center mb-4">
              <span class="loading loading-spinner loading-lg text-primary"></span>
            </div>
            <h2 class="card-title justify-center text-2xl mb-4">処理中</h2>
            <p class="text-base-content mb-4">検証ID: <span class="font-mono">{verification_id}</span></p>
            <p class="text-sm text-base-content/70 mb-6">この画面は5秒後に自動更新されます。</p>
            <div class="card-actions justify-center">
              <button class="btn btn-primary" onclick="location.reload()">手動更新</button>
            </div>
          </div>
        </div>
        
        <script>
          setTimeout(() => {{ location.reload(); }}, 5000);
        </script>
        """
        return wrapWithLayout(f"透かし検証中 - {APP_NAME}", content, "verify-watermark")

    elif result["status"] == "completed":
        result_data = result.get("result_data", {})

        if result_data.get("has_watermark"):
            extracted_id = result_data.get("extracted_id", "N/A")
            has_provenance = result_data.get("has_provenance", False)

            if has_provenance:
                provenance_url = result_data.get("provenance_url", "")
                content = f"""
                <div class="hero bg-gradient-to-r from-success to-accent text-success-content rounded-lg mb-8">
                  <div class="hero-content text-center py-12">
                    <div class="max-w-md">
                      <h1 class="mb-5 text-4xl font-bold">✅ 透かしが見つかりました</h1>
                      <p class="mb-5 text-lg">この画像には {APP_NAME} の透かしが埋め込まれています</p>
                    </div>
                  </div>
                </div>
                
                <div class="card bg-base-100 shadow-xl">
                  <div class="card-body text-center">
                    <h2 class="card-title justify-center text-2xl mb-4 text-success">検証成功</h2>
                    <div class="stats shadow mb-6">
                      <div class="stat">
                        <div class="stat-title">透かしID</div>
                        <div class="stat-value text-lg font-mono">{extracted_id}</div>
                      </div>
                    </div>
                    <p class="text-base-content mb-6">来歴が利用可能です。</p>
                    <div class="card-actions justify-center gap-4">
                      <a href="{provenance_url}" class="btn btn-success btn-lg">来歴を確認</a>
                      <button class="btn btn-outline" onclick="window.location.href='/verify-watermark'">別の画像を試す</button>
                    </div>
                  </div>
                </div>
                """
                return wrapWithLayout(f"透かし検証完了 - {APP_NAME}", content, "verify-watermark")
            else:
                content = f"""
                <div class="hero bg-gradient-to-r from-warning to-accent text-warning-content rounded-lg mb-8">
                  <div class="hero-content text-center py-12">
                    <div class="max-w-md">
                      <h1 class="mb-5 text-4xl font-bold">⚠️ 透かしは見つかりましたが...</h1>
                      <p class="mb-5 text-lg">この透かしに対応する来歴が見つかりませんでした</p>
                    </div>
                  </div>
                </div>
                
                <div class="card bg-base-100 shadow-xl">
                  <div class="card-body text-center">
                    <h2 class="card-title justify-center text-2xl mb-4 text-warning">来歴なし</h2>
                    <div class="stats shadow mb-6">
                      <div class="stat">
                        <div class="stat-title">透かしID</div>
                        <div class="stat-value text-lg font-mono">{extracted_id}</div>
                      </div>
                    </div>
                    <div class="alert alert-warning mb-6">
                      <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                      <span>透かしは検出されましたが、対応する来歴情報が見つかりませんでした。</span>
                    </div>
                    <div class="card-actions justify-center">
                      <button class="btn btn-primary" onclick="window.location.href='/verify-watermark'">別の画像を試す</button>
                    </div>
                  </div>
                </div>
                """
                return wrapWithLayout(f"透かし検証完了 - {APP_NAME}", content, "verify-watermark")
        else:
            content = f"""
            <div class="hero bg-gradient-to-r from-error to-warning text-error-content rounded-lg mb-8">
              <div class="hero-content text-center py-12">
                <div class="max-w-md">
                  <h1 class="mb-5 text-4xl font-bold">❌ 透かしが見つかりません</h1>
                  <p class="mb-5 text-lg">この画像には {APP_NAME} の透かしが埋め込まれていません</p>
                </div>
              </div>
            </div>
            
            <div class="card bg-base-100 shadow-xl">
              <div class="card-body text-center">
                <h2 class="card-title justify-center text-2xl mb-4 text-error">透かし未検出</h2>
                <div class="alert alert-error mb-6">
                  <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span>この画像は {APP_NAME} で生成されていない可能性があります。</span>
                </div>
                <div class="card-actions justify-center">
                  <button class="btn btn-primary" onclick="window.location.href='/verify-watermark'">別の画像を試す</button>
                </div>
              </div>
            </div>
            """
            return wrapWithLayout(f"透かし検証完了 - {APP_NAME}", content, "verify-watermark")

    elif result["status"] == "error":
        error_message = result.get("error_message", "不明なエラー")
        content = f"""
        <div class="hero bg-gradient-to-r from-error to-warning text-error-content rounded-lg mb-8">
          <div class="hero-content text-center py-12">
            <div class="max-w-md">
              <h1 class="mb-5 text-4xl font-bold">⚠️ 検証エラー</h1>
              <p class="mb-5 text-lg">検証中にエラーが発生しました</p>
            </div>
          </div>
        </div>
        
        <div class="card bg-base-100 shadow-xl">
          <div class="card-body text-center">
            <h2 class="card-title justify-center text-2xl mb-4 text-error">処理エラー</h2>
            <div class="stats shadow mb-6">
              <div class="stat">
                <div class="stat-title">検証ID</div>
                <div class="stat-value text-lg font-mono">{verification_id}</div>
              </div>
            </div>
            <div class="alert alert-error mb-6">
              <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <div>
                <div class="font-bold">エラー詳細</div>
                <div class="text-sm">{error_message}</div>
              </div>
            </div>
            <div class="card-actions justify-center">
              <button class="btn btn-primary" onclick="window.location.href='/verify-watermark'">別の画像を試す</button>
            </div>
          </div>
        </div>
        """
        return wrapWithLayout(f"検証エラー - {APP_NAME}", content, "verify-watermark")

    else:
        content = f"""
        <div class="hero bg-gradient-to-r from-warning to-error text-warning-content rounded-lg mb-8">
          <div class="hero-content text-center py-12">
            <div class="max-w-md">
              <h1 class="mb-5 text-4xl font-bold">⚠️ 不明なステータス</h1>
              <p class="mb-5 text-lg">予期しないステータスが返されました</p>
            </div>
          </div>
        </div>
        
        <div class="card bg-base-100 shadow-xl">
          <div class="card-body text-center">
            <h2 class="card-title justify-center text-2xl mb-4 text-warning">不明なステータス</h2>
            <div class="stats shadow mb-6">
              <div class="stat">
                <div class="stat-title">検証ID</div>
                <div class="stat-value text-lg font-mono">{verification_id}</div>
              </div>
              <div class="stat">
                <div class="stat-title">ステータス</div>
                <div class="stat-value text-lg">{result["status"]}</div>
              </div>
            </div>
            <div class="card-actions justify-center">
              <button class="btn btn-primary" onclick="window.location.href='/verify-watermark'">別の画像を試す</button>
            </div>
          </div>
        </div>
        """
        return wrapWithLayout(f"不明なステータス - {APP_NAME}", content, "verify-watermark")


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
