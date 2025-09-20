import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const APP_NAME = process.env.APP_NAME || 'btw';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const response = {
    appName: APP_NAME,
    title: `${APP_NAME} - Image Provenance Service`,
    description: 'Bluesky に投稿する画像の来歴証明サービス',
    features: [
      'Post - Bluesky に見えない電子透かしを埋め込んで画像を投稿する',
      'Provenance - 投稿時に画像の来歴ページを作成して公開する',
      'Verify - 画像の電子透かしを読み込んで来歴ページを表示する'
    ],
    links: {
      signup: '/signup',
      login: '/login',
      mypage: '/mypage',
      verify: '/verify-watermark',
      manual: 'https://zenn.dev/snowsheep/books/e94f4392a2f467'
    }
  };

  return { statusCode: 200, headers, body: JSON.stringify(response) };
};