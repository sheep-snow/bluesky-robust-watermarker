import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// アプリ名を環境変数から取得
const APP_NAME = process.env.APP_NAME || 'brw';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Callback event:', JSON.stringify(event, null, 2));

  const headers = {
    'Content-Type': 'text/html',
    'Access-Control-Allow-Origin': '*'
  };

  const queryParams = event.queryStringParameters || {};
  const authCode = queryParams.code;
  const error = queryParams.error;

  console.log('Query params:', queryParams);
  console.log('Auth code:', authCode);
  console.log('Error:', error);

  if (error) {
    return {
      statusCode: 400,
      headers,
      body: `<html><body><h1>Authentication failed</h1><p>Error: ${error}</p></body></html>`
    };
  }

  if (authCode) {
    try {
      // Cognitoトークンエンドポイントでコードをトークンに交換
      const tokenResponse = await fetch(`${process.env.COGNITO_DOMAIN}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: process.env.USER_POOL_CLIENT_ID!,
          code: authCode,
          redirect_uri: `https://${process.env.DOMAIN_NAME}/callback`
        })
      });

      if (!tokenResponse.ok) {
        throw new Error(`Token exchange failed: ${tokenResponse.status}`);
      }

      const tokens = await tokenResponse.json() as any;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Authentication Successful</title>
          <script>
            // トークンをlocalStorageに保存
            localStorage.setItem('access_token', '${tokens.access_token}');
            localStorage.setItem('id_token', '${tokens.id_token}');
            // マイページにリダイレクト
            window.location.href = 'https://${process.env.DOMAIN_NAME}/mypage';
          </script>
        </head>
        <body>
          <p>Authentication successful. Redirecting to your page...</p>
        </body>
        </html>
      `;
      return { statusCode: 200, headers, body: html };
    } catch (error) {
      console.error('Token exchange error:', error);
      return {
        statusCode: 500,
        headers,
        body: `<html><body><h1>Authentication failed</h1><p>Token exchange error</p></body></html>`
      };
    }
  }

  return {
    statusCode: 400,
    headers,
    body: `<html><body><h1>Authentication failed</h1><p>No authorization code received</p><p>Query params: ${JSON.stringify(queryParams)}</p><p>Event: ${JSON.stringify(event.queryStringParameters)}</p></body></html>`
  };
};