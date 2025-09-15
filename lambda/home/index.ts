import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { wrapWithLayout } from '../common/ui-framework';

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

  const content = `
    <div class="hero min-h-96 bg-gradient-to-r from-primary to-secondary text-primary-content rounded-lg mb-8">
      <div class="hero-content text-center">
        <div class="max-w-md">
          <h1 class="mb-5 text-5xl font-bold"> ${APP_NAME}</h1>
          <p class="mb-5 text-xl">Bluesky に投稿する画像の来歴証明サービス</p>
          <div class="flex gap-4 justify-center items-center" id="hero-actions">
            <a href="/signup" class="btn btn-accent btn-lg" id="hero-signup">Get Started</a>
            <a href="/login" class="btn btn-soft btn-lg" id="hero-login">Login</a>
            <a href="/verify-watermark" class="btn btn-soft btn-lg" id="hero-verify">Verify</a>
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

        <p class="mb-5">以下の機能を提供します:</p>
        <ul class="list-disc list-inside text-left mb-5">
          <li>Post - Bluesky に見えない電子透かしを埋め込んで画像を投稿する</li>
          <li>Provenance - 投稿時に画像の来歴ページを作成して公開する</li>
          <li>Verify - 画像の電子透かしを読み込んで来歴ページを表示する</li>
        </ul>
        <p class="mb-5">つかいかた:</p>
        <a href="https://zenn.dev/snowsheep/books/e94f4392a2f467" class="btn btn-primary btn-md">User Manual</a>
        </div>
    </div>

    <script>
      // Check authentication status and update UI
      function checkAuthAndUpdateUI() {
        const accessToken = localStorage.getItem('access_token');
        const idToken = localStorage.getItem('id_token');
        const isAuthenticated = accessToken && idToken;
        
        if (isAuthenticated) {
          // Hide signup/login elements
          const navSignup = document.querySelector('a[href="/signup"]');
          const navLogin = document.querySelector('a[href="/login"]');
          if (navSignup) navSignup.style.display = 'none';
          if (navLogin) navLogin.style.display = 'none';
          
          const heroSignup = document.getElementById('hero-signup');
          const heroLogin = document.getElementById('hero-login');
          if (heroSignup) heroSignup.style.display = 'none';
          if (heroLogin) heroLogin.style.display = 'none';
          
          // Show authenticated elements
          const heroActions = document.getElementById('hero-actions');
          const heroAuth = document.getElementById('hero-authenticated');
          if (heroActions) heroActions.classList.add('hidden');
          if (heroAuth) heroAuth.classList.remove('hidden');
        }
      }
      
      // Initialize auth UI on page load
      document.addEventListener('DOMContentLoaded', checkAuthAndUpdateUI);
    </script>
  `;

  const html = wrapWithLayout(`${APP_NAME} - Image Provenance Service`, content, 'home');

  return { statusCode: 200, headers, body: html };
};