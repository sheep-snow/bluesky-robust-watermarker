import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// アプリ名を環境変数から取得
const APP_NAME = process.env.APP_NAME || 'brw';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'text/html',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const html = `
    <!DOCTYPE html>
    <html data-theme="cupcake">
    <head>
      <title>${APP_NAME} - Image Provenance Service</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link href="/tailwind.min.css" rel="stylesheet" type="text/css" />
      <script>
        function initTheme() {
          const savedTheme = localStorage.getItem('${APP_NAME.toLowerCase()}-theme') || 'cupcake';
          document.documentElement.setAttribute('data-theme', savedTheme);
        }
        function changeTheme(theme) {
          document.documentElement.setAttribute('data-theme', theme);
          localStorage.setItem('${APP_NAME.toLowerCase()}-theme', theme);
        }
        document.addEventListener('DOMContentLoaded', initTheme);
      </script>
    </head>
    <body class="min-h-screen flex flex-col bg-base-200">
      <div class="navbar bg-base-100 shadow-lg">
        <div class="navbar-start">
          <a href="/" class="btn btn-ghost text-xl"> ${APP_NAME}</a>
        </div>
        <div class="navbar-center hidden lg:flex">
          <ul class="menu menu-horizontal px-1">
            <li><a href="/" class="active">Home</a></li>
            <li><a href="/signup" id="nav-signup">Sign Up</a></li>
            <li><a href="/login" id="nav-login">Login</a></li>
            <li><a href="/mypage" id="nav-mypage">My Page</a></li>
            <li><a href="/verify-watermark">Verify</a></li>
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
      
      <main class="flex-1 container mx-auto px-4 py-8">
        <div class="hero min-h-96 bg-gradient-to-r from-primary to-secondary text-primary-content rounded-lg mb-8">
          <div class="hero-content text-center">
            <div class="max-w-md">
              <h1 class="mb-5 text-5xl font-bold"> ${APP_NAME}</h1>
              <p class="mb-5 text-xl">Bluesky に投稿する画像の来歴証明サービス</p>
              <div class="flex gap-4 justify-center items-center" id="hero-actions">
                <a href="/signup" class="btn btn-accent btn-lg" id="hero-signup">Get Started</a>
                <a href="/login" class="btn btn-outline btn-lg" id="hero-login">Login</a>
                <a href="/verify-watermark" class="btn btn-outline btn-lg" id="hero-verify">Verify</a>
              </div>
              <div class="hidden" id="hero-authenticated">
                <a href="/mypage" class="btn btn-primary btn-lg">Go to My Page</a>
              </div>
            </div>
          </div>
        </div>

        <div class="card bg-base-100 shadow-xl mb-8">
          <div class="card-body">
            <h2 class="card-title text-2xl mb-4">What is ${APP_NAME}?</h2>
            <p class="text-lg">
              ${APP_NAME} Blueskyに投稿する画像の出所を証明するのに役立つサービスです
            </p>
          </div>
        </div>

        <div class="card bg-base-100 shadow-xl mb-8">
          <div class="card-body">
            <h2 class="card-title text-2xl mb-4">How It Works</h2>
            <div class="steps steps-vertical lg:steps-horizontal">
              <div class="step step-primary">Sign Up</div>
              <div class="step step-primary">Connect Bluesky</div>
              <div class="step step-primary">Post Images</div>
              <div class="step step-primary">Generate Proof</div>
              <div class="step step-primary">Verification</div>
            </div>
          </div>
        </div>
      </main>
      
      <footer class="footer footer-center p-10 bg-base-200 text-base-content rounded">
        <aside>
          <p>© 2025 ${APP_NAME} - Image Provenance Service</p>
        </aside>
      </footer>
      
      <script>
        // Check authentication status and update UI
        function checkAuthAndUpdateUI() {
          const accessToken = localStorage.getItem('access_token');
          const idToken = localStorage.getItem('id_token');
          const isAuthenticated = accessToken && idToken;
          
          if (isAuthenticated) {
            // Hide signup/login elements
            document.getElementById('nav-signup').style.display = 'none';
            document.getElementById('nav-login').style.display = 'none';
            document.getElementById('hero-signup').style.display = 'none';
            document.getElementById('hero-login').style.display = 'none';
            
            // Show authenticated elements
            document.getElementById('auth-actions').classList.remove('hidden');
            document.getElementById('hero-actions').classList.add('hidden');
            document.getElementById('hero-authenticated').classList.remove('hidden');
          } else {
            // Show signup/login elements
            document.getElementById('nav-signup').style.display = 'block';
            document.getElementById('nav-login').style.display = 'block';
            document.getElementById('hero-signup').style.display = '';
            document.getElementById('hero-login').style.display = '';
            
            // Hide authenticated elements
            document.getElementById('auth-actions').classList.add('hidden');
            document.getElementById('hero-actions').classList.remove('hidden');
            document.getElementById('hero-authenticated').classList.add('hidden');
          }
        }
        
        function logout() {
          localStorage.removeItem('access_token');
          localStorage.removeItem('id_token');
          localStorage.removeItem('refresh_token');
          window.location.href = '/';
        }
        
        // Initialize auth UI on page load
        document.addEventListener('DOMContentLoaded', checkAuthAndUpdateUI);
      </script>
    </body>
    </html>
  `;

  return { statusCode: 200, headers, body: html };
};