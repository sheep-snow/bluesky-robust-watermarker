import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { wrapWithLayout } from '../common/ui-framework';

const APP_NAME = process.env.APP_NAME || 'brw';
const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod === 'GET') {
    const content = `
      <div class="hero bg-gradient-to-r from-primary to-secondary text-primary-content rounded-lg mb-8">
        <div class="hero-content text-center py-12">
          <div class="max-w-md">
            <h1 class="mb-5 text-4xl font-bold">📝 Sign Up</h1>
            <p class="mb-5 text-lg">Welcome to ${APP_NAME} - Bluesky Image Provenance Service</p>
          </div>
        </div>
      </div>
      
      <div class="flex justify-center">
        <div class="card bg-base-100 shadow-xl w-full max-w-md">
          <div class="card-body">
            <h2 class="card-title justify-center mb-4">Create Your Account</h2>
            <p class="mb-6">Sign up with your Google account to get started</p>
            <a href="${process.env.COGNITO_DOMAIN}/oauth2/authorize?client_id=${process.env.USER_POOL_CLIENT_ID}&response_type=code&scope=email+openid&redirect_uri=https://${process.env.DOMAIN_NAME}/callback" 
               class="btn btn-primary btn-lg">
              <svg class="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Sign up with Google
            </a>
            <div class="divider">OR</div>
            <p class="text-sm text-base-content/70">Already have an account?</p>
            <a href="/login" class="btn btn-soft">Login Instead</a>
          </div>
        </div>
      </div>
      
      <script>
        function checkAuthAndRedirect() {
          const accessToken = localStorage.getItem('access_token');
          const idToken = localStorage.getItem('id_token');
          if (accessToken && idToken) {
            // Already authenticated, redirect to mypage
            window.location.href = '/mypage';
          }
        }
        
        document.addEventListener('DOMContentLoaded', checkAuthAndRedirect);
      </script>
    `;

    const html = wrapWithLayout(`${APP_NAME} - Sign Up`, content, 'signup');
    return { statusCode: 200, headers: { ...headers, 'Content-Type': 'text/html' }, body: html };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};