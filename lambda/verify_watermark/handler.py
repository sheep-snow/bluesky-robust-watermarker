import base64
import importlib.util
import json
import logging
import os
from typing import Any, Dict, Optional

import boto3

# アプリ名を環境変数から取得
APP_NAME = os.environ.get("APP_NAME", "brw")
DOMAIN_NAME = os.environ.get("DOMAIN_NAME", "brw-example.app")

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize S3 client
s3_client = boto3.client("s3")

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
    logger.warning("Could not load watermark_utils module")

    # Fallback functions (will be replaced by common utils)
    def extract_nano_id_from_watermark(image_data: bytes) -> Dict[str, Any]:
        return {"extractedId": None, "method": "fallback", "confidence": 0.0}

    def embed_watermark_to_image_data(image_data: bytes, nano_id: str) -> bytes:
        return image_data

    def verify_watermark_embedding(
        image_data: bytes, expected_id: str
    ) -> Dict[str, Any]:
        return {"extractedId": None, "method": "fallback", "confidence": 0.0}

# from trustmark import TrustMark  # Temporarily disabled


def get_html_response(html_content: str) -> Dict[str, Any]:
    """Return an HTML response for API Gateway."""
    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "text/html; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST",
            "Access-Control-Allow-Headers": "Content-Type",
        },
        "body": html_content,
    }


def get_json_response(data: Dict[str, Any], status_code: int = 200) -> Dict[str, Any]:
    """Return a JSON response for API Gateway."""
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST",
            "Access-Control-Allow-Headers": "Content-Type",
        },
        "body": json.dumps(data),
    }


def get_redirect_response(location: str) -> Dict[str, Any]:
    """Return a redirect response for API Gateway."""
    return {
        "statusCode": 302,
        "headers": {
            "Location": location,
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST",
            "Access-Control-Allow-Headers": "Content-Type",
        },
        "body": "",
    }


def get_file_extension_from_signature(image_data: bytes) -> str:
    """Detect file extension from image signature."""
    if image_data[:2] == b"\xff\xd8":
        return ".jpg"
    elif image_data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    elif image_data[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    elif image_data[:4] == b"RIFF" and image_data[8:12] == b"WEBP":
        return ".webp"
    else:
        # Default to jpg if unknown
        return ".jpg"


def extract_image_from_multipart(body: bytes, content_type: str) -> Optional[bytes]:
    """Extract image data from multipart form data."""
    try:
        boundary = content_type.split("boundary=")[1]
        if not boundary:
            logger.error("No boundary found in content-type: %s", content_type)
            return None

        logger.info("Parsing multipart with boundary: %s", boundary)

        body_string = body.decode("latin-1")  # Use latin-1 to preserve binary data

        # Split by boundary
        parts = body_string.split(f"--{boundary}")

        for i in range(
            1, len(parts) - 1
        ):  # Skip first empty part and last closing part
            part = parts[i]

            # Find headers section
            header_end_index = part.find("\r\n\r\n")
            if header_end_index == -1:
                continue

            headers = part[:header_end_index]
            content = part[header_end_index + 4 :]

            logger.info("Part headers: %s", headers)

            # Check if this part contains the image field
            if 'name="image"' in headers and "Content-Type: image/" in headers:
                logger.info("Found image part, content length: %d", len(content))

                # Convert string back to bytes, then remove trailing CRLF if present
                content_bytes = content.encode("latin-1")

                if len(content_bytes) >= 2 and content_bytes[-2:] == b"\r\n":
                    content_bytes = content_bytes[:-2]

                logger.info("Extracted image data length: %d", len(content_bytes))
                return content_bytes

        logger.info("No image field found in multipart data")
        return None
    except Exception as error:
        logger.error("Error extracting image from multipart: %s", error)
        return None


async def get_provenance_data(post_id: str) -> Optional[Dict[str, Any]]:
    """Get provenance data for a post ID."""
    try:
        logger.info("Looking up provenance data for postId: %s", post_id)

        # Get provenance bucket name from environment variables
        provenance_public_bucket = os.environ.get("PROVENANCE_PUBLIC_BUCKET")
        if not provenance_public_bucket:
            logger.warning("PROVENANCE_PUBLIC_BUCKET environment variable not set")
            return None

        # Check if provenance page exists in S3
        try:
            response = s3_client.head_object(
                Bucket=provenance_public_bucket, Key=f"provenance/{post_id}/index.html"
            )

            logger.info("Found provenance data for postId: %s", post_id)

            # Return basic data indicating provenance exists
            return {
                "postId": post_id,
                "provenanceUrl": f"https://{DOMAIN_NAME}/provenance/{post_id}",
                "verified": True,
                "timestamp": response.get("LastModified", "").isoformat()
                if response.get("LastModified")
                else "",
            }

        except s3_client.exceptions.NoSuchKey:
            logger.info("No provenance data found for postId: %s", post_id)
            return None
        except Exception as s3_error:
            logger.error("S3 error checking provenance: %s", s3_error)
            return None

    except Exception as error:
        logger.error("Error getting provenance data: %s", error)
        return None


def generate_upload_form_html() -> str:
    """Generate the HTML form for watermark verification."""
    app_name_lower = APP_NAME.lower()
    return f"""<!DOCTYPE html>
<html data-theme="cupcake">
<head>
    <title>{APP_NAME} - 透かし検証</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://cdn.jsdelivr.net/npm/daisyui@4.12.10/dist/full.min.css" rel="stylesheet" type="text/css" />
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      function initTheme() {{
        const savedTheme = localStorage.getItem('{app_name_lower}-theme') || 'cupcake';
        document.documentElement.setAttribute('data-theme', savedTheme);
      }}
      function changeTheme(theme) {{
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('{app_name_lower}-theme', theme);
      }}
      document.addEventListener('DOMContentLoaded', initTheme);
    </script>
</head>
<body class="min-h-screen flex flex-col bg-base-200">
    <div class="navbar bg-base-100 shadow-lg">
      <div class="navbar-start">
        <a href="/" class="btn btn-ghost text-xl">📄 {APP_NAME}</a>
      </div>
      <div class="navbar-center hidden lg:flex">
        <ul class="menu menu-horizontal px-1">
          <li><a href="/">Home</a></li>
          <li><a href="/signup" id="nav-signup">Sign Up</a></li>
          <li><a href="/login" id="nav-login">Login</a></li>
          <li><a href="/verify-watermark" class="active">Verify Watermark</a></li>
          <li><a href="/mypage" id="nav-mypage">My Page</a></li>
        </ul>
      </div>
      <div class="navbar-end">
        <div class="hidden" id="auth-actions">
          <button onclick="logout()" class="btn btn-error btn-sm mr-2">Logout</button>
        </div>
        <div class="dropdown dropdown-end">
          <div tabindex="0" role="button" class="btn btn-ghost">
            Theme
            <svg width="12px" height="12px" class="h-2 w-2 fill-current opacity-60 inline-block" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048"><path d="m1799 349 242 241-1017 1017L7 590l242-241 775 775 775-775z"></path></svg>
          </div>
          <ul tabindex="0" class="dropdown-content z-[1] p-2 shadow-2xl bg-base-300 rounded-box w-52">
            <li><input type="radio" name="theme-dropdown" class="theme-controller btn btn-sm btn-block btn-ghost justify-start" aria-label="Cupcake" value="cupcake" onclick="changeTheme('cupcake')"/></li>
            <li><input type="radio" name="theme-dropdown" class="theme-controller btn btn-sm btn-block btn-ghost justify-start" aria-label="Dark" value="dark" onclick="changeTheme('dark')"/></li>
            <li><input type="radio" name="theme-dropdown" class="theme-controller btn btn-sm btn-block btn-ghost justify-start" aria-label="Emerald" value="emerald" onclick="changeTheme('emerald')"/></li>
            <li><input type="radio" name="theme-dropdown" class="theme-controller btn btn-sm btn-block btn-ghost justify-start" aria-label="Corporate" value="corporate" onclick="changeTheme('corporate')"/></li>
          </ul>
        </div>
      </div>
    </div>
    
    <div class="container mx-auto px-4 py-8 flex-1">
      <div class="hero bg-gradient-to-r from-primary to-secondary text-primary-content rounded-lg mb-8">
        <div class="hero-content text-center py-12">
          <div class="max-w-md">
            <h1 class="mb-5 text-4xl font-bold">🔍 透かし検証</h1>
            <p class="mb-5 text-lg">画像の真正性を検証します</p>
          </div>
        </div>
      </div>
      
      <div class="card bg-base-100 shadow-xl">
        <div class="card-body">
          <div class="upload-area border-2 border-dashed border-primary rounded-lg p-8 text-center bg-base-200 hover:bg-base-300 transition-all duration-300" 
               ondrop="handleDrop(event)" 
               ondragover="handleDragOver(event)" 
               ondragenter="handleDragEnter(event)" 
               ondragleave="handleDragLeave(event)">
            <input type="file" id="file-input" accept="image/*" onchange="handleFileSelect(event)" class="hidden">
            <div class="text-6xl mb-4">📷</div>
            <label for="file-input" class="btn btn-primary mb-4">画像をアップロード</label>
            <p class="text-base-content/70">または画像をここにドラッグ&ドロップ</p>
            <p class="text-sm text-base-content/50 mt-2">対応形式: JPEG, PNG, WebP</p>
          </div>
          
          <div id="selected-file" class="hidden mt-6 p-4 bg-base-200 rounded-lg">
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-3">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span id="file-name" class="font-medium"></span>
              </div>
              <button onclick="clearFile()" class="btn btn-sm btn-ghost">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          
          <div class="card-actions justify-end mt-6">
            <button id="verify-btn" onclick="verifyWatermark()" class="btn btn-accent btn-lg" disabled>
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              検証開始
            </button>
          </div>
        </div>
      </div>
      
      <div id="result" class="hidden mt-8"></div>
    </div>
    
    <footer class="footer footer-center p-10 bg-base-200 text-base-content rounded">
      <div>
        <a href="/" class="btn btn-ghost">📄 {APP_NAME} Home</a>
        <p class="mt-2">Copyright © 2025 - All right reserved by {APP_NAME}</p>
      </div>
    </footer>

    <script>
        let selectedFile = null;

        function handleDragOver(e) {{
            e.preventDefault();
        }}

        function handleDragEnter(e) {{
            e.preventDefault();
            e.currentTarget.classList.add('border-accent');
        }}

        function handleDragLeave(e) {{
            e.preventDefault();
            e.currentTarget.classList.remove('border-accent');
        }}

        function handleDrop(e) {{
            e.preventDefault();
            e.currentTarget.classList.remove('border-accent');
            const files = e.dataTransfer.files;
            if (files.length > 0) {{
                handleFileSelect({{target: {{files: files}}}});
            }}
        }}

        function handleFileSelect(e) {{
            const file = e.target.files[0];
            if (file) {{
                selectedFile = file;
                document.getElementById('file-name').textContent = file.name + ' (' + (file.size / 1024 / 1024).toFixed(2) + 'MB)';
                document.getElementById('selected-file').classList.remove('hidden');
                document.getElementById('verify-btn').disabled = false;
            }}
        }}

        function clearFile() {{
            selectedFile = null;
            document.getElementById('file-input').value = '';
            document.getElementById('selected-file').classList.add('hidden');
            document.getElementById('verify-btn').disabled = true;
        }}

        async function verifyWatermark() {{
            if (!selectedFile) {{
                alert('画像を選択してください');
                return;
            }}

            const formData = new FormData();
            formData.append('image', selectedFile);

            const btn = document.getElementById('verify-btn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '<span class="loading loading-spinner loading-sm"></span> 解析中...';
            btn.disabled = true;

            try {{
                const response = await fetch(window.location.href, {{
                    method: 'POST',
                    body: formData
                }});

                if (response.redirected) {{
                    window.location.href = response.url;
                }} else {{
                    const result = await response.text();
                    document.getElementById('result').innerHTML = result;
                    document.getElementById('result').classList.remove('hidden');
                }}
            }} catch (error) {{
                console.error('Upload error:', error);
                alert('アップロードエラーが発生しました: ' + error.message);
            }} finally {{
                btn.innerHTML = originalText;
                btn.disabled = false;
            }}
        }}
        
        // Check authentication status and update UI
        function checkAuthAndUpdateUI() {{
          const accessToken = localStorage.getItem('access_token');
          const idToken = localStorage.getItem('id_token');
          const isAuthenticated = accessToken && idToken;
          
          if (isAuthenticated) {{
            document.getElementById('nav-signup').style.display = 'none';
            document.getElementById('nav-login').style.display = 'none';
            document.getElementById('auth-actions').classList.remove('hidden');
          }} else {{
            document.getElementById('nav-signup').style.display = 'block';
            document.getElementById('nav-login').style.display = 'block';
            document.getElementById('auth-actions').classList.add('hidden');
          }}
        }}
        
        function logout() {{
          localStorage.removeItem('access_token');
          localStorage.removeItem('id_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/';
        }}
        
        document.addEventListener('DOMContentLoaded', function() {{
          initTheme();
          checkAuthAndUpdateUI();
        }});
    </script>
</body>
</html>"""


def generate_error_page(message: str) -> str:
    """Generate an error page."""
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{APP_NAME} - エラー</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .container {{
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }}
        .error-icon {{
            font-size: 64px;
            color: #e74c3c;
            margin-bottom: 20px;
        }}
        h1 {{
            color: #e74c3c;
            margin-bottom: 20px;
        }}
        .back-btn {{
            background-color: #3498db;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            margin-top: 20px;
        }}
        .back-btn:hover {{
            background-color: #2980b9;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">❌</div>
        <h1>エラー</h1>
        <p>{message}</p>
        <button class="back-btn" onclick="history.back()">戻る</button>
    </div>
</body>
</html>"""


def generate_no_watermark_page(extraction_result: Dict[str, Any]) -> str:
    """Generate a page for when no watermark is found."""
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{APP_NAME} - 透かしが見つかりません</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .container {{
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }}
        .warning-icon {{
            font-size: 64px;
            color: #f39c12;
            margin-bottom: 20px;
        }}
        h1 {{
            color: #e67e22;
            margin-bottom: 20px;
        }}
        .details {{
            background-color: #f8f9fa;
            border-radius: 6px;
            padding: 15px;
            margin: 20px 0;
            text-align: left;
        }}
        .back-btn {{
            background-color: #3498db;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            margin-top: 20px;
        }}
        .back-btn:hover {{
            background-color: #2980b9;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="warning-icon">⚠️</div>
        <h1>透かしが見つかりません</h1>
        <p>アップロードされた画像から{APP_NAME}透かしを検出できませんでした。</p>
        
        <div class="details">
            <h3>検証詳細</h3>
            <p><strong>検証方法:</strong> {extraction_result.get("method", "不明")}</p>
            <p><strong>信頼度:</strong> {(extraction_result.get("confidence", 0) * 100):.1f}%</p>
            <p><strong>可能な原因:</strong></p>
            <ul>
                <li>この画像は{APP_NAME}で投稿されていない</li>
                <li>画像が圧縮や加工により透かしが消失している</li>
                <li>透かし埋め込み処理に問題があった</li>
            </ul>
        </div>
        
        <button class="back-btn" onclick="history.back()">別の画像を試す</button>
    </div>
</body>
</html>"""


def generate_no_provenance_page(post_id: str, extraction_result: Dict[str, Any]) -> str:
    """Generate a page for when provenance data is not found."""
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{APP_NAME} - 来歴が見つかりません</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .container {{
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }}
        .info-icon {{
            font-size: 64px;
            color: #3498db;
            margin-bottom: 20px;
        }}
        h1 {{
            color: #2c3e50;
            margin-bottom: 20px;
        }}
        .details {{
            background-color: #f8f9fa;
            border-radius: 6px;
            padding: 15px;
            margin: 20px 0;
            text-align: left;
        }}
        .post-id {{
            font-family: 'Courier New', monospace;
            background-color: #e9ecef;
            padding: 5px 8px;
            border-radius: 4px;
            font-weight: bold;
        }}
        .back-btn {{
            background-color: #3498db;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
            margin-top: 20px;
        }}
        .back-btn:hover {{
            background-color: #2980b9;
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="info-icon">🔍</div>
        <h1>来歴データが見つかりません</h1>
        <p>透かしから投稿IDは検出されましたが、対応する来歴データが見つかりませんでした。</p>
        
        <div class="details">
            <h3>検出情報</h3>
            <p><strong>検出された投稿ID:</strong> <span class="post-id">{post_id}</span></p>
            <p><strong>検証方法:</strong> {extraction_result.get("method", "不明")}</p>
            <p><strong>信頼度:</strong> {(extraction_result.get("confidence", 0) * 100):.1f}%</p>
            <p><strong>可能な原因:</strong></p>
            <ul>
                <li>投稿データが削除されている</li>
                <li>透かしの解読に誤りがある</li>
                <li>データベースの同期問題</li>
            </ul>
        </div>
        
        <button class="back-btn" onclick="history.back()">別の画像を試す</button>
    </div>
</body>
</html>"""


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for watermark verification.
    """
    logger.info("Verify watermark handler starting...")
    logger.info("Event received: %s", json.dumps(event, default=str))

    try:
        # Get HTTP method
        http_method = event.get("httpMethod", "GET")

        if http_method == "GET":
            # Display upload form
            return get_html_response(generate_upload_form_html())

        elif http_method == "POST":
            # Process uploaded image and extract watermark
            content_type = event.get("headers", {}).get("content-type") or event.get(
                "headers", {}
            ).get("Content-Type", "")

            if not content_type or "multipart/form-data" not in content_type:
                return get_html_response(
                    generate_error_page("無効なリクエスト形式です。")
                )

            # Parse multipart form data
            body = event.get("body", "")
            if event.get("isBase64Encoded", False):
                body = base64.b64decode(body)
            else:
                body = body.encode("utf-8")

            image_data = extract_image_from_multipart(body, content_type)

            if not image_data:
                logger.warning("Failed to extract image data from multipart form")
                return get_html_response(
                    generate_error_page("画像データが見つかりませんでした。")
                )

            logger.info("Processing uploaded image (%d bytes)", len(image_data))

            # Extract Nano ID from watermark using Python version
            extraction_result = extract_nano_id_from_watermark(image_data)

            if not extraction_result.get("extractedId"):
                return get_html_response(generate_no_watermark_page(extraction_result))

            # Look up provenance data
            import asyncio

            provenance_data = asyncio.run(
                get_provenance_data(extraction_result["extractedId"])
            )

            if not provenance_data:
                return get_html_response(
                    generate_no_provenance_page(
                        extraction_result["extractedId"], extraction_result
                    )
                )

            # Redirect to provenance page
            provenance_url = (
                f"https://{DOMAIN_NAME}/provenance/{extraction_result['extractedId']}"
            )
            return get_redirect_response(provenance_url)

        else:
            return get_html_response(
                generate_error_page("サポートされていないHTTPメソッドです。")
            )

    except Exception as error:
        logger.error("Error in verify watermark handler: %s", error, exc_info=True)
        return get_html_response(
            generate_error_page("内部サーバーエラーが発生しました。")
        )
