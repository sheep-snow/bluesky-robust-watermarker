import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: 'us-east-1' });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (!authHeader) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Authorization required' })
      };
    }

    const { handle, password } = JSON.parse(event.body || '{}');
    
    if (!handle || !password) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Handle and password required' })
      };
    }

    // Extract user ID from JWT (simplified)
    const token = authHeader.replace('Bearer ', '');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    const userId = payload.sub;

    // Save user config to S3
    const userConfig = {
      bluesky_handle: handle,
      app_password: password,
      updated_at: new Date().toISOString()
    };

    await s3.send(new PutObjectCommand({
      Bucket: process.env.USER_INFO_BUCKET,
      Key: `${userId}.json`,
      Body: JSON.stringify(userConfig),
      ContentType: 'application/json'
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};