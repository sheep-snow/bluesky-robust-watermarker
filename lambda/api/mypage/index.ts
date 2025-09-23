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

// Generate empty provenance list page for new users
async function generateEmptyProvenanceList(userInfo: any) {
  const content = `
    <div class="hero bg-gradient-to-r from-primary to-secondary text-primary-content rounded-lg mb-8">
      <div class="hero-content text-center py-12">
        <div class="max-w-md">
          <h1 class="mb-5 text-4xl font-bold">📄 Provenance List</h1>
          <h2 class="mb-5 text-2xl font-bold">${userInfo.blueskyUserId}</h2>
          <p class="mb-5 text-lg">来歴の一覧</p>
        </div>
      </div>
    </div>
    <div class="hero min-h-64 bg-base-100 rounded-lg">
      <div class="hero-content text-center">
        <div class="max-w-md">
          <div class="text-6xl mb-4">🔍</div>
          <h3 class="text-xl font-bold mb-4">No Verified Posts Found</h3>
          <p class="text-base-content/70">No verified posts found for this user yet.</p>
        </div>
      </div>
    </div>
  `;

  const listPageHtml = `<!DOCTYPE html><html><head><title>${APP_NAME} - ${userInfo.blueskyUserId} Provenance List</title></head><body>${content}</body></html>`;

  const listPageCommand = new PutObjectCommand({
    Bucket: process.env.PROVENANCE_PUBLIC_BUCKET,
    Key: `users/${userInfo.provenancePageId}.html`,
    Body: listPageHtml,
    ContentType: 'text/html'
  });
  await s3Client.send(listPageCommand);

  console.log(`Empty provenance list created for user: ${userInfo.blueskyUserId}`);
}

// Check if provenance list exists for a user
async function checkProvenanceListExists(provenancePageId: string): Promise<boolean> {
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.PROVENANCE_PUBLIC_BUCKET,
      Key: `users/${provenancePageId}.html`
    });
    await s3Client.send(command);
    return true;
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      return false;
    }
    throw error;
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
  console.log('Starting Bluesky validation for:', userId);

  try {
    const agent = new AtpAgent({ service: 'https://bsky.social' });
    console.log('AtpAgent created successfully');

    try {
      const loginResult = await agent.login({
        identifier: userId,
        password: appPassword
      });

      console.log('✅ Login successful!');
      if (agent.session) {
        console.log('✅ Session created successfully');
        console.log('Session DID:', agent.session.did);
        console.log('Session handle:', agent.session.handle);
        return true;
      } else {
        console.log('⚠️ Login succeeded but no session created');
        return false;
      }
    } catch (loginError: any) {
      console.log('❌ Login failed with error:');
      console.log('Error message:', loginError.message);
      return false;
    }

  } catch (error: any) {
    console.error('❌ Fatal error in validateBlueskyCredentials:');
    console.error('Error message:', error.message);
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

        // If user info exists but provenance list doesn't exist, create it
        if (userInfo && userInfo.provenancePageId) {
          try {
            const provenanceListExists = await checkProvenanceListExists(userInfo.provenancePageId);
            if (!provenanceListExists) {
              console.log(`Provenance list not found for user ${userInfo.blueskyUserId}, creating empty list`);
              await generateEmptyProvenanceList(userInfo);
            }
          } catch (error) {
            console.error('Failed to check/create provenance list:', error);
            // Don't fail the entire request if provenance list check fails
          }
        }

        return { statusCode: 200, headers, body: JSON.stringify(userInfo || {}) };
      }

      // Return basic page info for GET /api/mypage
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          title: `${APP_NAME} - My Page`,
          appName: APP_NAME,
          description: 'Blueskyのアプリパスワードを登録し、作品を投稿する'
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

        const isNewUser = !existingUserInfo;
        if (isNewUser) {
          userInfo.createdAt = userInfo.updatedAt;
        }

        const putCommand = new PutObjectCommand({
          Bucket: process.env.USER_INFO_BUCKET,
          Key: `${userId}.json`,
          Body: JSON.stringify(userInfo),
          ContentType: 'application/json'
        });

        await s3Client.send(putCommand);

        // Generate empty provenance list for new users
        if (isNewUser) {
          try {
            await generateEmptyProvenanceList(userInfo);
            console.log(`Empty provenance list created for new user: ${userInfo.blueskyUserId}`);
          } catch (error) {
            console.error('Failed to create empty provenance list:', error);
            // Don't fail the entire request if provenance list creation fails
          }
        }

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