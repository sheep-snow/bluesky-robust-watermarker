import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SSMClient } from '@aws-sdk/client-ssm';
const { AtpAgent } = require('@atproto/api');
const { sanitizeUserInput } = require('../common/sanitize');
const sharp = require('sharp');

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

const updateProgress = async (taskId: string, status: string, progress: number, message: string, error?: string) => {
  try {
    const tableName = process.env.PROCESSING_PROGRESS_TABLE_NAME;
    if (!tableName) return;
    
    const item: any = {
      task_id: { S: taskId },
      status: { S: status },
      progress: { N: progress.toString() },
      message: { S: message },
      updated_at: { S: Math.floor(Date.now() / 1000).toString() },
      ttl: { N: (Math.floor(Date.now() / 1000) + 86400).toString() }
    };
    
    if (error) item.error = { S: error };
    
    await dynamodb.send(new PutItemCommand({ TableName: tableName, Item: item }));
  } catch (e) {
    console.error('Failed to update progress:', e);
  }
};

const markFailed = async (taskId: string, errorMessage: string, progress: number = 40) => {
  await updateProgress(taskId, 'error', progress, 'Bluesky posting failed', errorMessage);
};

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const kmsClient = new KMSClient({ region: process.env.AWS_REGION });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

const APP_NAME = process.env.APP_NAME || 'brw';

async function detectFacets(text: string) {
  const facets = [];
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(text);

  // Detect URLs
  const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g;
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    let url = match[1];
    // Remove trailing punctuation that's likely not part of the URL
    url = url.replace(/[.,;:!?\)\]}>"']+$/, '');

    const start = encoder.encode(text.substring(0, match.index)).length;
    const end = start + encoder.encode(url).length;
    facets.push({
      index: { byteStart: start, byteEnd: end },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: url }]
    });
  }

  // Detect mentions (@handle) with DID resolution
  const mentionRegex = /(@[^\s\r\n]+)\s?/g;
  const mentionPromises = [];
  const mentionMatches = [];

  while ((match = mentionRegex.exec(text)) !== null) {
    const fullMatch = match[1]; // @handle part without trailing space
    const handle = fullMatch.substring(1); // Remove @ symbol
    if (handle.length > 0) {
      mentionMatches.push({ match, fullMatch, handle });
    }
  }

  // Resolve DIDs for all mentions
  for (const { match, fullMatch, handle } of mentionMatches) {
    mentionPromises.push(
      (async () => {
        try {
          // Try to resolve DID for the handle
          const response = await fetch(`https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`);
          if (response.ok) {
            const data = await response.json();
            if (data.did) {
              const start = encoder.encode(text.substring(0, match.index)).length;
              const end = start + encoder.encode(fullMatch).length;
              return {
                index: { byteStart: start, byteEnd: end },
                features: [{ $type: 'app.bsky.richtext.facet#mention', did: data.did }]
              };
            }
          }
        } catch (error) {
          console.log(`Failed to resolve DID for handle ${handle}:`, error);
        }
        return null; // If DID resolution fails, treat as plain text
      })()
    );
  }

  // Wait for all DID resolutions and add successful ones to facets
  const mentionFacets = await Promise.all(mentionPromises);
  facets.push(...mentionFacets.filter(f => f !== null));

  // Detect hashtags (#tag) - supports multibyte characters including Japanese
  const hashtagRegex = /((#)[^ \r\n]*)( |\r\n|\n|\r)?/g;
  while ((match = hashtagRegex.exec(text)) !== null) {
    const fullMatch = match[1]; // #tag part without trailing space
    const tag = fullMatch.substring(1); // Remove # symbol
    if (tag.length > 0) {
      const start = encoder.encode(text.substring(0, match.index)).length;
      const end = start + encoder.encode(fullMatch).length;
      facets.push({
        index: { byteStart: start, byteEnd: end },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: tag }]
      });
    }
  }

  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

async function decryptPassword(encryptedPassword: string) {
  const decryptCommand = new DecryptCommand({
    CiphertextBlob: Buffer.from(encryptedPassword, 'base64')
  });
  const result = await kmsClient.send(decryptCommand);
  return Buffer.from(result.Plaintext!).toString('utf8');
}

export const handler = async (event: any) => {
  console.log('Post to Bluesky handler started, event:', event);

  // Handle array input from Map task
  const inputData = Array.isArray(event) ? event[0] : event;
  const { postId, bucket = process.env.POST_DATA_BUCKET } = inputData;
  
  try {
    await updateProgress(postId, 'posting', 35, 'Starting Bluesky post');
    // Get post data first to extract correct userId
    console.log('Attempting to get post.json from S3:', { bucket, key: `${postId}/post.json` });
    const postCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: `${postId}/post.json`
    });
    const postDataResult = await s3Client.send(postCommand);
    const postData = JSON.parse(await postDataResult.Body!.transformToString());
    console.log('Post data loaded successfully:', {
      hasText: !!postData.text,
      imageExtension: postData.imageExtension,
      imageFormat: postData.imageFormat,
      hasImage: !!postData.image,
      userId: postData.userId
    });

    // Use the userId from post.json, not from event
    const userId = postData.userId;
    console.log('Using userId from post.json:', userId);

    // Get user info
    const userCommand = new GetObjectCommand({
      Bucket: process.env.USER_INFO_BUCKET,
      Key: `${userId}.json`
    });
    const userResult = await s3Client.send(userCommand);
    const rawUserInfo = JSON.parse(await userResult.Body!.transformToString());
    const userInfo = sanitizeUserInput(rawUserInfo);
    console.log('User info loaded:', { blueskyUserId: userInfo.blueskyUserId, hasEncryptedPassword: !!userInfo.encryptedBlueskyAppPassword });

    // Decrypt Bluesky password
    const blueskyPassword = await decryptPassword(userInfo.encryptedBlueskyAppPassword);
    console.log('Password decrypted, length:', blueskyPassword.length);

    // Initialize Bluesky agent
    await updateProgress(postId, 'posting', 40, 'Connecting to Bluesky');
    const agent = new AtpAgent({ service: 'https://bsky.social' });
    console.log('Attempting login with identifier:', userInfo.blueskyUserId);
    await agent.login({
      identifier: userInfo.blueskyUserId,
      password: blueskyPassword
    });
    console.log('Login successful');

    // Prepare post content
    const postContent: any = {
      text: postData.text,
      createdAt: new Date().toISOString()
    };

    // Add facets for links, mentions, and hashtags
    if (postData.text) {
      const facets = await detectFacets(postData.text);
      if (facets.length > 0) {
        postContent.facets = facets;
      }
    }

    // Add content labels if specified
    if (postData.contentLabels && postData.contentLabels.length > 0) {
      postContent.labels = {
        $type: 'com.atproto.label.defs#selfLabels',
        values: postData.contentLabels.map((label: string) => ({
          val: label
        }))
      };
    }

    // Add images if they exist
    if (postData.imageMetadata && postData.imageMetadata.length > 0) {
      try {
        const images = [];

        for (const imageMeta of postData.imageMetadata) {
          const imageKey = `${postId}/image${imageMeta.index}.${imageMeta.extension}`;

          console.log('Attempting to get image from S3:', { bucket, imageKey });

          const imageCommand = new GetObjectCommand({
            Bucket: bucket,
            Key: imageKey
          });
          const imageResult = await s3Client.send(imageCommand);
          const imageBuffer = await imageResult.Body!.transformToByteArray();

          console.log(`Successfully retrieved image ${imageMeta.index} from S3, size:`, imageBuffer.length);

          // Get image dimensions
          const metadata = await sharp(imageBuffer).metadata();
          const { width, height } = metadata;

          // Upload image to Bluesky with correct encoding
          const encoding = imageMeta.format === 'jpeg' ? 'image/jpeg' : 'image/png';
          const uploadResult = await agent.uploadBlob(imageBuffer, {
            encoding: encoding
          });

          images.push({
            image: uploadResult.data.blob,
            alt: imageMeta.altText || '',
            aspectRatio: {
              width: width,
              height: height
            }
          });
        }

        if (images.length > 0) {
          postContent.embed = {
            $type: 'app.bsky.embed.images',
            images: images
          };
        }
      } catch (imageError) {
        console.log('Failed to get images from S3:', imageError);
        console.log('Posting without images');
        // Continue without images
      }
    }

    // Post to Bluesky
    await updateProgress(postId, 'posting', 60, 'Publishing to Bluesky');
    const blueskyResult = await agent.api.com.atproto.repo.createRecord({
      repo: agent.session.did,
      collection: 'app.bsky.feed.post',
      record: postContent
    });
    console.log('Posted to Bluesky:', blueskyResult.data);
    
    await updateProgress(postId, 'posting', 70, 'Bluesky post completed');

    return {
      ...inputData,
      userId: userId, // Use the correct userId from post.json
      blueskyPostUri: blueskyResult.data.uri,
      blueskyPostCid: blueskyResult.data.cid,
      postedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('Bluesky posting failed:', error);
    await markFailed(postId, error.message || 'Unknown error');
    throw error;
  }
};