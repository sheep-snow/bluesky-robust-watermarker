import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION });

function decodeJWT(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64').toString('utf8');
    return JSON.parse(payload);
  } catch (error) {
    return null;
  }
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.path === '/api/auth/user-info' && event.httpMethod === 'GET') {
    try {
      const authHeader = event.headers.Authorization || event.headers.authorization;
      if (!authHeader) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'No authorization header' })
        };
      }

      const token = authHeader.replace('Bearer ', '');
      const decoded = decodeJWT(token);
      
      if (!decoded || !decoded.sub) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'Invalid token' })
        };
      }

      // Check if user has Bluesky account registered
      let blueskyUserId = null;
      try {
        const command = new GetObjectCommand({
          Bucket: process.env.USER_INFO_BUCKET,
          Key: `${decoded.sub}.json`
        });
        const response = await s3Client.send(command);
        const userInfo = JSON.parse(await response.Body!.transformToString());
        blueskyUserId = userInfo.blueskyUserId;
      } catch (error) {
        // User info not found, that's ok
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          userId: decoded.sub,
          email: decoded.email,
          blueskyUserId
        })
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Internal server error' })
      };
    }
  }

  return {
    statusCode: 404,
    headers,
    body: JSON.stringify({ error: 'Not found' })
  };
};