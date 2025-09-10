import base64
import importlib.util
import json
import logging
import os
import time
import uuid
from typing import Any, Dict, Optional

import boto3

# アプリ名を環境変数から取得
APP_NAME = os.environ.get("APP_NAME", "brw")
DOMAIN_NAME = os.environ.get("DOMAIN_NAME", "brw-example.app")
CLOUDFRONT_DOMAIN = os.environ.get("CLOUDFRONT_DOMAIN", "")
VERIFICATION_RESULTS_TABLE = os.environ.get("VERIFICATION_RESULTS_TABLE", "")
PROVENANCE_PUBLIC_BUCKET_NAME = os.environ.get("PROVENANCE_PUBLIC_BUCKET_NAME", "")


# AWS_REGIONは予約変数なのでboto3から動的取得
def get_region():
    try:
        return boto3.Session().region_name or "us-east-1"
    except Exception:
        return "us-east-1"


# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
s3_client = boto3.client("s3")
dynamodb_client = boto3.client("dynamodb")


def save_verification_result(
    verification_id: str,
    status: str,
    result_data: Optional[Dict] = None,
    error_message: Optional[str] = None,
):
    """Save verification result to DynamoDB."""
    try:
        logger.info(
            f"Attempting to save verification result for ID: {verification_id}, status: {status}"
        )
        logger.info(f"DynamoDB table name: {VERIFICATION_RESULTS_TABLE}")

        item = {
            "verification_id": {"S": verification_id},
            "status": {"S": status},
            "timestamp": {"N": str(int(time.time()))},
            "ttl": {"N": str(int(time.time()) + 86400)},  # 24 hours TTL
        }

        if result_data:
            item["result_data"] = {"S": json.dumps(result_data)}
            logger.info("Added result_data to item")

        if error_message:
            item["error_message"] = {"S": error_message}
            logger.info("Added error_message to item")

        logger.info(f"Putting item to DynamoDB: {item}")
        dynamodb_client.put_item(TableName=VERIFICATION_RESULTS_TABLE, Item=item)
        logger.info(f"Successfully saved verification result for ID: {verification_id}")
    except Exception as e:
        logger.error(f"Failed to save verification result: {e}", exc_info=True)


def process_watermark_async(verification_id: str, image_data: bytes):
    """Process watermark extraction asynchronously."""
    logger.info(f"Starting async processing for verification ID: {verification_id}")

    try:
        # Update status to processing
        save_verification_result(verification_id, "processing")
        logger.info(
            f"Updated status to processing for verification ID: {verification_id}"
        )

        logger.info(
            f"Extracting Nano ID from watermark, image size: {len(image_data)} bytes"
        )

        # Extract Nano ID from watermark using Python version
        extraction_result = extract_nano_id_from_watermark(image_data)

        logger.info(f"Extraction result: {extraction_result}")

        if not extraction_result.get("extractedId"):
            result_data = {
                "has_watermark": False,
                "extraction_result": extraction_result,
            }
            save_verification_result(
                verification_id, "completed", result_data=result_data
            )
            logger.info(f"No watermark found for verification ID: {verification_id}")
            return

        extracted_id = extraction_result["extractedId"]
        logger.info(f"Extracted ID: {extracted_id}")

        # Look up provenance data synchronously to avoid asyncio issues
        try:
            # Use urllib instead of requests to avoid dependency issues
            from urllib.request import Request, urlopen

            # Try multiple possible provenance data locations using CloudFront
            possible_urls = [
                f"https://{CLOUDFRONT_DOMAIN}/provenance/{extracted_id}/index.html",
                f"https://{CLOUDFRONT_DOMAIN}/{extracted_id}.json",
                f"https://{CLOUDFRONT_DOMAIN}/provenance/{extracted_id}.json",
            ]

            provenance_data = None

            for provenance_url in possible_urls:
                try:
                    logger.info(f"Checking provenance data at: {provenance_url}")

                    req = Request(provenance_url)
                    req.add_header(
                        "User-Agent", "Mozilla/5.0 (compatible; chronico-verifier)"
                    )

                    with urlopen(req, timeout=30) as response:
                        if response.status == 200:
                            content = response.read().decode("utf-8")
                            # Check if it's HTML or JSON
                            if provenance_url.endswith(".html"):
                                # For HTML files, just mark as found
                                provenance_data = {
                                    "type": "html",
                                    "url": provenance_url,
                                }
                                logger.info(
                                    f"Found HTML provenance data at {provenance_url}"
                                )
                                break
                            else:
                                # Try to parse as JSON
                                provenance_data = json.loads(content)
                                logger.info(
                                    f"Found JSON provenance data at {provenance_url}"
                                )
                                break
                        else:
                            logger.info(
                                f"No data found at {provenance_url} (status: {response.status})"
                            )
                except Exception as url_error:
                    logger.info(f"Failed to fetch from {provenance_url}: {url_error}")
                    continue

            if not provenance_data:
                logger.info(
                    f"No provenance data found at any location for ID: {extracted_id}"
                )

        except Exception as prov_error:
            logger.warning(f"Error fetching provenance data: {prov_error}")
            provenance_data = None

        result_data = {
            "has_watermark": True,
            "extracted_id": extracted_id,
            "extraction_result": extraction_result,
            "has_provenance": provenance_data is not None,
        }

        if provenance_data:
            result_data["provenance_url"] = (
                f"https://{DOMAIN_NAME}/provenance/{extracted_id}"
            )
            result_data["provenance_data"] = provenance_data

        save_verification_result(verification_id, "completed", result_data=result_data)
        logger.info(
            f"Completed async processing for verification ID: {verification_id}"
        )

    except Exception as e:
        logger.error(
            f"Error in async processing for verification ID {verification_id}: {e}"
        )
        logger.error(f"Exception type: {type(e).__name__}")
        logger.error(f"Exception args: {e.args}")
        import traceback

        logger.error(f"Traceback: {traceback.format_exc()}")

        try:
            save_verification_result(verification_id, "error", error_message=str(e))
            logger.info(f"Saved error status for verification ID: {verification_id}")
        except Exception as save_error:
            logger.error(f"Failed to save error status: {save_error}")

    logger.info(
        f"Async processing function completed for verification ID: {verification_id}"
    )


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

        # Handle body that may have been corrupted by API Gateway
        body_string: str
        try:
            # If body is UTF-8 encoded string data, try to recover
            if isinstance(body, bytes):
                # Try to decode as UTF-8 first, then re-encode as latin-1
                try:
                    body_string = body.decode("utf-8")
                    logger.info("Successfully decoded body as UTF-8")
                except UnicodeDecodeError:
                    # If UTF-8 fails, try latin-1 directly
                    body_string = body.decode("latin-1")
                    logger.info("Successfully decoded body as latin-1")
            else:
                body_string = str(body)
                logger.info("Body is already string")
        except Exception as decode_error:
            logger.error(f"Failed to decode body: {decode_error}")
            return None

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

                # Convert string back to bytes, handling both cases
                try:
                    # First try latin-1 encoding to preserve byte values
                    content_bytes = content.encode("latin-1")
                    logger.info("Successfully encoded content as latin-1")
                except UnicodeEncodeError:
                    # If that fails, the content is already corrupted
                    # Try to extract what we can
                    content_bytes = content.encode("utf-8", errors="replace")
                    logger.warning(
                        "Content was corrupted, using UTF-8 with replacement"
                    )

                if len(content_bytes) >= 2 and content_bytes[-2:] == b"\r\n":
                    content_bytes = content_bytes[:-2]

                logger.info("Extracted image data length: %d", len(content_bytes))

                # Validate that this looks like image data
                if content_bytes.startswith((b"\xff\xd8\xff", b"\x89PNG", b"GIF")):
                    logger.info("Image data appears to be valid")
                    return content_bytes
                else:
                    logger.warning(
                        "Image data does not appear to be valid image format"
                    )
                    # Log the first few bytes for debugging
                    logger.warning(f"First 20 bytes: {content_bytes[:20]}")
                    # Try to return it anyway for debugging
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

                if (response.headers.get('content-type')?.includes('application/json')) {{
                    // Handle JSON response (async processing)
                    const result = await response.json();
                    if (result.verification_id) {{
                        // Show processing status and redirect to check page
                        const statusHtml = `
                            <div class="alert alert-info">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                </svg>
                                <div>
                                    <h3 class="font-bold">検証を開始しました</h3>
                                    <p class="text-sm">検証ID: ${{result.verification_id}}</p>
                                    <p class="text-sm">処理には1-2分かかります。結果ページに自動で移動します...</p>
                                </div>
                            </div>
                        `;
                        document.getElementById('result').innerHTML = statusHtml;
                        document.getElementById('result').classList.remove('hidden');
                        
                        // Redirect to result page after 3 seconds
                        setTimeout(() => {{
                            window.location.href = result.check_url;
                        }}, 3000);
                    }}
                }} else if (response.redirected) {{
                    // Handle redirect (old behavior - should not happen with async)
                    window.location.href = response.url;
                }} else {{
                    // Handle HTML response (error pages)
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
            raw_body = event.get("body", "")
            logger.info(
                f"Body type: {type(raw_body)}, isBase64Encoded: {event.get('isBase64Encoded', False)}"
            )

            if event.get("isBase64Encoded", False):
                body = base64.b64decode(raw_body)
                logger.info(f"Decoded base64 body length: {len(body)}")
            else:
                # Body is already a string from API Gateway
                if isinstance(raw_body, str):
                    # API Gateway may have already decoded the body incorrectly
                    # Try to get raw bytes by re-encoding with ISO-8859-1 which preserves byte values
                    try:
                        body = raw_body.encode("iso-8859-1")
                        logger.info(f"Encoded body length with iso-8859-1: {len(body)}")
                    except UnicodeEncodeError as e:
                        logger.error(f"Failed to encode body with iso-8859-1: {e}")
                        # Fallback: encode as UTF-8 with error handling
                        body = raw_body.encode("utf-8", errors="replace")
                        logger.info(
                            f"Encoded body length with utf-8 (fallback): {len(body)}"
                        )
                else:
                    body = raw_body
                    logger.info(f"Body is already bytes, length: {len(body)}")

            image_data = extract_image_from_multipart(body, content_type)

            if not image_data:
                logger.warning("Failed to extract image data from multipart form")
                return get_html_response(
                    generate_error_page("画像データが見つかりませんでした。")
                )

            logger.info("Processing uploaded image (%d bytes)", len(image_data))

            # Generate verification ID
            verification_id = str(uuid.uuid4())
            logger.info(f"Generated verification ID: {verification_id}")

            # Save initial status to DynamoDB
            logger.info(
                f"Saving initial status to DynamoDB table: {VERIFICATION_RESULTS_TABLE}"
            )
            save_verification_result(verification_id, "started")

            # Process watermark synchronously (with 15 minute timeout)
            logger.info("Starting synchronous watermark processing")
            try:
                process_watermark_async(verification_id, image_data)
                logger.info("Watermark processing completed successfully")

                # Return immediate response with verification ID
                response_data = {
                    "verification_id": verification_id,
                    "status": "completed",
                    "message": "透かし検証が完了しました。結果確認はcheck-resultエンドポイントをご利用ください。",
                    "check_url": f"https://{DOMAIN_NAME}/check-result?id={verification_id}",
                }

            except Exception as processing_error:
                logger.error(f"Error during watermark processing: {processing_error}")
                response_data = {
                    "verification_id": verification_id,
                    "status": "error",
                    "message": "透かし検証中にエラーが発生しました。結果確認はcheck-resultエンドポイントをご利用ください。",
                    "check_url": f"https://{DOMAIN_NAME}/check-result?id={verification_id}",
                }

            logger.info(f"Returning JSON response: {response_data}")
            return get_json_response(response_data)

        else:
            return get_html_response(
                generate_error_page("サポートされていないHTTPメソッドです。")
            )

    except Exception as error:
        logger.error("Error in verify watermark handler: %s", error, exc_info=True)
        return get_html_response(
            generate_error_page("内部サーバーエラーが発生しました。")
        )
