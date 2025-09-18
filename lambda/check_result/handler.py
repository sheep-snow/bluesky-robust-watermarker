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
    def wrapWithLayout(title: str, content: str, active_page: str = "") -> str:
        """Wrap content with DaisyUI layout matching mypage design."""
        app_name_lower = APP_NAME.lower()
        return f"""<!DOCTYPE html>
<html data-theme="cupcake">
<head>
    <title>{title}</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://{DOMAIN_NAME}/tailwind.min.css" rel="stylesheet" type="text/css" />
    <script>
        const THEMES = [
            'light', 'dark', 'cupcake', 'bumblebee', 'emerald', 'corporate', 
            'synthwave', 'retro', 'cyberpunk', 'valentine', 'halloween', 'garden',
            'forest', 'aqua', 'lofi', 'pastel', 'fantasy', 'wireframe', 'black',
            'luxury', 'dracula', 'cmyk', 'autumn', 'business', 'acid', 'lemonade',
            'night', 'coffee', 'winter', 'dim', 'nord', 'sunset'
        ];
        
        function initTheme() {{
            const savedTheme = localStorage.getItem('{app_name_lower}-theme') || 'cupcake';
            document.documentElement.setAttribute('data-theme', savedTheme);
        }}
        
        function changeTheme(theme) {{
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('{app_name_lower}-theme', theme);
        }}
        
        function logout() {{
            localStorage.removeItem('access_token');
            localStorage.removeItem('id_token');
            localStorage.removeItem('refresh_token');
            window.location.href = '/';
        }}
        
        document.addEventListener('DOMContentLoaded', initTheme);
    </script>
</head>
<body class="min-h-screen flex flex-col">
    <div class="navbar bg-base-100 shadow-lg">
        <div class="navbar-start">
            <div class="dropdown">
                <div tabindex="0" role="button" class="btn btn-ghost lg:hidden">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h8m-8 6h16"></path>
                    </svg>
                </div>
                <ul tabindex="0" class="menu menu-sm dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52">
                    <li><a href="/" class="{"active" if active_page == "home" else ""}">Home</a></li>
                    <li><a href="/signup" class="{"active" if active_page == "signup" else ""}">Sign Up</a></li>
                    <li><a href="/login" class="{"active" if active_page == "login" else ""}">Login</a></li>
                    <li><a href="/mypage" class="{"active" if active_page == "mypage" else ""}">My Page</a></li>
                    <li><a href="/verify-watermark" class="{"active" if active_page == "verify-watermark" else ""}">Verify</a></li>
                </ul>
            </div>
            <a href="/" class="btn btn-ghost text-xl">{APP_NAME}</a>
        </div>
        <div class="navbar-center hidden lg:flex">
            <ul class="menu menu-horizontal px-1">
                <li><a href="/" class="{"active" if active_page == "home" else ""}">Home</a></li>
                <li><a href="/signup" class="{"active" if active_page == "signup" else ""}">Sign Up</a></li>
                <li><a href="/login" class="{"active" if active_page == "login" else ""}">Login</a></li>
                <li><a href="/mypage" class="{"active" if active_page == "mypage" else ""}">My Page</a></li>
                <li><a href="/verify-watermark" class="{"active" if active_page == "verify-watermark" else ""}">Verify</a></li>
            </ul>
        </div>
        <div class="navbar-end">
            <div class="hidden" id="auth-actions">
                <button onclick="logout()" class="btn btn-error btn-sm mr-2">Logout</button>
            </div>
            <div class="dropdown dropdown-end">
                <div tabindex="0" role="button" class="btn btn-ghost btn-circle">
                    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"></path>
                    </svg>
                </div>
                <ul tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52 max-h-96 overflow-y-auto">
                    <li class="menu-title">Choose Theme</li>
                    <li><a onclick="changeTheme('light')">🌞 Light</a></li>
                    <li><a onclick="changeTheme('dark')">🌙 Dark</a></li>
                    <li><a onclick="changeTheme('cupcake')">🧁 Cupcake</a></li>
                    <li><a onclick="changeTheme('bumblebee')">🐝 Bumblebee</a></li>
                    <li><a onclick="changeTheme('emerald')">💎 Emerald</a></li>
                    <li><a onclick="changeTheme('corporate')">🏢 Corporate</a></li>
                    <li><a onclick="changeTheme('synthwave')">🌆 Synthwave</a></li>
                    <li><a onclick="changeTheme('retro')">📻 Retro</a></li>
                    <li><a onclick="changeTheme('cyberpunk')">🤖 Cyberpunk</a></li>
                    <li><a onclick="changeTheme('valentine')">💝 Valentine</a></li>
                    <li><a onclick="changeTheme('halloween')">🎃 Halloween</a></li>
                    <li><a onclick="changeTheme('garden')">🌸 Garden</a></li>
                    <li><a onclick="changeTheme('forest')">🌲 Forest</a></li>
                    <li><a onclick="changeTheme('aqua')">🌊 Aqua</a></li>
                    <li><a onclick="changeTheme('lofi')">🎵 Lofi</a></li>
                    <li><a onclick="changeTheme('pastel')">🎨 Pastel</a></li>
                    <li><a onclick="changeTheme('fantasy')">🦄 Fantasy</a></li>
                    <li><a onclick="changeTheme('wireframe')">📐 Wireframe</a></li>
                    <li><a onclick="changeTheme('black')">⚫ Black</a></li>
                    <li><a onclick="changeTheme('luxury')">💰 Luxury</a></li>
                    <li><a onclick="changeTheme('dracula')">🧛 Dracula</a></li>
                    <li><a onclick="changeTheme('cmyk')">🎨 CMYK</a></li>
                    <li><a onclick="changeTheme('autumn')">🍂 Autumn</a></li>
                    <li><a onclick="changeTheme('business')">💼 Business</a></li>
                    <li><a onclick="changeTheme('acid')">🧪 Acid</a></li>
                    <li><a onclick="changeTheme('lemonade')">🍋 Lemonade</a></li>
                    <li><a onclick="changeTheme('night')">🌃 Night</a></li>
                    <li><a onclick="changeTheme('coffee')">☕ Coffee</a></li>
                    <li><a onclick="changeTheme('winter')">❄️ Winter</a></li>
                    <li><a onclick="changeTheme('dim')">🔅 Dim</a></li>
                    <li><a onclick="changeTheme('nord')">🏔️ Nord</a></li>
                    <li><a onclick="changeTheme('sunset')">🌅 Sunset</a></li>
                </ul>
            </div>
        </div>
    </div>
    <main class="flex-1 container mx-auto px-4 py-8">
        {content}
    </main>
    <footer class="footer footer-center p-10 bg-base-200 text-base-content rounded">
        <aside>
            <p>© 2025 {APP_NAME} - Image Provenance Service</p>
        </aside>
    </footer>
    <script>
        function checkAuthAndUpdateNav() {{
            const accessToken = localStorage.getItem('access_token');
            const idToken = localStorage.getItem('id_token');
            const isAuthenticated = accessToken && idToken;
            
            const signupLinks = document.querySelectorAll('a[href="/signup"]');
            const loginLinks = document.querySelectorAll('a[href="/login"]');
            const authActions = document.getElementById('auth-actions');
            
            signupLinks.forEach(link => {{
                if (link.closest('li')) {{
                    link.closest('li').style.display = isAuthenticated ? 'none' : '';
                }} else {{
                    link.style.display = isAuthenticated ? 'none' : '';
                }}
            }});
            
            loginLinks.forEach(link => {{
                if (link.closest('li')) {{
                    link.closest('li').style.display = isAuthenticated ? 'none' : '';
                }} else {{
                    link.style.display = isAuthenticated ? 'none' : '';
                }}
            }});
            
            if (authActions) {{
                authActions.classList.toggle('hidden', !isAuthenticated);
            }}
        }}
        
        document.addEventListener('DOMContentLoaded', checkAuthAndUpdateNav);
    </script>
</body>
</html>"""

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
                return wrapWithLayout(
                    f"透かし検証完了 - {APP_NAME}", content, "verify-watermark"
                )
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
                return wrapWithLayout(
                    f"透かし検証完了 - {APP_NAME}", content, "verify-watermark"
                )
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
            return wrapWithLayout(
                f"透かし検証完了 - {APP_NAME}", content, "verify-watermark"
            )

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
        return wrapWithLayout(
            f"不明なステータス - {APP_NAME}", content, "verify-watermark"
        )


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
