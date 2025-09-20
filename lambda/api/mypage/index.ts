const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { KMSClient, EncryptCommand, DecryptCommand } = require('@aws-sdk/client-kms');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { AtpAgent } = require('@atproto/api');
const { sanitizeUserInput } = require('../../common/sanitize');
const { detectImageFormat, getImageExtension, getContentType } = require('../../common/image-utils');

const APP_NAME = process.env.APP_NAME || 'brw';

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

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const kmsClient = new KMSClient({ region: process.env.AWS_REGION });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });

const { nanoid } = require('nanoid');

class PostIdGenerator {
  static generate() {
    return nanoid(8);
  }
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function getUserInfo(userId: string) {
  try {
    const getCommand = new GetObjectCommand({
      Bucket: process.env.USER_INFO_BUCKET,
      Key: `${userId}.json`
    });
    const result = await s3Client.send(getCommand);
    const rawUserInfo = JSON.parse(await result.Body.transformToString());
    const userInfo = sanitizeUserInput(rawUserInfo);
    return {
      blueskyUserId: userInfo.blueskyUserId,
      updatedAt: userInfo.updatedAt,
      validatedAt: userInfo.validatedAt,
      provenancePageId: userInfo.provenancePageId,
      createdAt: userInfo.createdAt
    };
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      return null;
    }
    throw error;
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

async function validateBlueskyCredentials(userId: string, appPassword: string) {
  try {
    const agent = new AtpAgent({ service: 'https://bsky.social' });
    const loginResult = await agent.login({
      identifier: userId,
      password: appPassword
    });
    return agent.session ? true : false;
  } catch (error: any) {
    return false;
  }
}

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
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
      if (event.path === '/api/mypage/info' || (event.pathParameters && event.pathParameters.proxy === 'info')) {
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader) {
          return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
        }

        const token = authHeader.replace('Bearer ', '');
        const decoded = decodeJWT(token);
        const userId = decoded?.sub;

        if (!userId) {
          return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
        }

        const userInfo = await getUserInfo(userId);
        return { statusCode: 200, headers, body: JSON.stringify(userInfo || {}) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          title: `${APP_NAME} - My Page`,
          description: 'Blueskyのアプリパスワードを登録し、作品を投稿する',
          endpoints: {
            userInfo: '/api/mypage/info',
            saveSettings: '/api/mypage',
            createPost: '/api/mypage/post'
          }
        })
      };
    }

    if (event.httpMethod === 'POST') {
      const authHeader = event.headers.Authorization || event.headers.authorization;
      if (!authHeader) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
      }

      const token = authHeader.replace('Bearer ', '');
      const decoded = decodeJWT(token);
      const userId = decoded?.sub;

      if (!userId) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
      }

      if (!event.body) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Request body is required' }) };
      }

      const rawBody = JSON.parse(event.body);
      const body = sanitizeUserInput(rawBody);

      if (event.path === '/api/mypage/post' || (event.pathParameters && event.pathParameters.proxy === 'post')) {
        const postId = PostIdGenerator.generate();

        const imageMetadata = [];
        if (body.images && body.images.length > 0) {
          for (let i = 0; i < body.images.length; i++) {
            const imageData = body.images[i];
            const imageBuffer = Buffer.from(imageData.image, 'base64');
            const imageFormat = detectImageFormat(new Uint8Array(imageBuffer));
            const imageExtension = getImageExtension(imageFormat);
            const contentType = getContentType(imageFormat);

            const imageCommand = new PutObjectCommand({
              Bucket: process.env.POST_DATA_BUCKET,
              Key: `${postId}/image${i + 1}.${imageExtension}`,
              Body: imageBuffer,
              ContentType: contentType
            });
            await s3Client.send(imageCommand);

            imageMetadata.push({
              index: i + 1,
              format: imageFormat,
              extension: imageExtension,
              altText: imageData.altText || ''
            });
          }
        }

        const postDataForStorage = {
          postId,
          userId,
          text: body.text || '',
          contentLabels: body.contentLabels || [],
          interactionSettings: body.interactionSettings || { reply: 'everyone', replyOptions: [] },
          createdAt: new Date().toISOString(),
          imageMetadata: imageMetadata
        };

        const putCommand = new PutObjectCommand({
          Bucket: process.env.POST_DATA_BUCKET,
          Key: `${postId}/post.json`,
          Body: JSON.stringify(postDataForStorage),
          ContentType: 'application/json'
        });
        await s3Client.send(putCommand);

        const queueMessage = {
          postId,
          userId,
          bucket: process.env.POST_DATA_BUCKET,
          timestamp: new Date().toISOString()
        };

        const sendCommand = new SendMessageCommand({
          QueueUrl: process.env.POST_QUEUE_URL,
          MessageBody: JSON.stringify(queueMessage)
        });
        await sqsClient.send(sendCommand);

        return { statusCode: 200, headers, body: JSON.stringify({ postId, message: 'Post queued successfully' }) };
      } else {
        const isValid = await validateBlueskyCredentials(body.blueskyUserId, body.blueskyAppPassword);
        if (!isValid) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid Bluesky credentials. Please check your User ID and App Password.' })
          };
        }

        const keyParam = await ssmClient.send(new GetParameterCommand({
          Name: `/${APP_NAME}/${process.env.STAGE}/kms-key-id`
        }));
        const kmsKeyId = keyParam.Parameter.Value;

        const encryptedPassword = await encryptPassword(body.blueskyAppPassword, kmsKeyId);
        const existingUserInfo = await getUserInfo(userId);

        const userInfo = {
          blueskyUserId: body.blueskyUserId,
          encryptedBlueskyAppPassword: encryptedPassword,
          provenancePageId: existingUserInfo?.provenancePageId || generateUUID(),
          updatedAt: new Date().toISOString(),
          validatedAt: new Date().toISOString(),
          ...(existingUserInfo && { createdAt: existingUserInfo.createdAt })
        };

        if (!existingUserInfo) {
          userInfo.createdAt = userInfo.updatedAt;
        }

        const putCommand = new PutObjectCommand({
          Bucket: process.env.USER_INFO_BUCKET,
          Key: `${userId}.json`,
          Body: JSON.stringify(userInfo),
          ContentType: 'application/json'
        });

        await s3Client.send(putCommand);

        return { statusCode: 200, headers, body: JSON.stringify({ message: '設定を保存しました' }) };
      }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (error) {
    console.error('Error:', error);
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};