import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { KMSClient, EncryptCommand } from '@aws-sdk/client-kms';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { AtpAgent } from '@atproto/api';

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const kmsClient = new KMSClient({ region: process.env.AWS_REGION });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

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

async function encryptPassword(password: string, keyId: string) {
  const encryptCommand = new EncryptCommand({
    KeyId: keyId,
    Plaintext: Buffer.from(password, 'utf8')
  });
  const result = await kmsClient.send(encryptCommand);
  return Buffer.from(result.CiphertextBlob).toString('base64');
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

  if (event.path === '/api/bluesky/register' && event.httpMethod === 'POST') {
    try {
      const { userId, password } = JSON.parse(event.body || '{}');
      
      if (!userId || !password) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing userId or password' })
        };
      }

      // Test Bluesky connection
      const agent = new AtpAgent({ service: 'https://bsky.social' });
      await agent.login({ identifier: userId, password });

      // Get KMS key ID
      const kmsKeyParam = await ssmClient.send(new GetParameterCommand({
        Name: `/${process.env.APP_NAME}/${process.env.STAGE}/kms-key-id`
      }));
      const keyId = kmsKeyParam.Parameter!.Value!;

      // Encrypt password
      const encryptedPassword = await encryptPassword(password, keyId);

      // Generate provenance page ID
      const provenancePageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Save user info
      const userInfo = {
        blueskyUserId: userId,
        encryptedPassword,
        provenancePageId,
        createdAt: new Date().toISOString()
      };

      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.USER_INFO_BUCKET,
        Key: `${decoded.sub}.json`,
        Body: JSON.stringify(userInfo),
        ContentType: 'application/json'
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, userId })
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to register Bluesky account' })
      };
    }
  }

  return {
    statusCode: 404,
    headers,
    body: JSON.stringify({ error: 'Not found' })
  };
};