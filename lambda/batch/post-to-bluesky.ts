import { DecryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SSMClient } from '@aws-sdk/client-ssm';
const { AtpAgent } = require('@atproto/api');
const { sanitizeUserInput } = require('../common/sanitize');
const sharp = require('sharp');

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const kmsClient = new KMSClient({ region: process.env.AWS_REGION });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

const APP_NAME = process.env.APP_NAME || 'brw';

async function decryptPassword(encryptedPassword: string) {
  const decryptCommand = new DecryptCommand({
    CiphertextBlob: Buffer.from(encryptedPassword, 'base64')
  });
  const result = await kmsClient.send(decryptCommand);
  return Buffer.from(result.Plaintext!).toString('utf8');
}

export const handler = async (event: any) => {
  console.log('Post to Bluesky event:', JSON.stringify(event, null, 2));

  const { postId, bucket } = event;

  try {
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
    const blueskyResult = await agent.api.com.atproto.repo.createRecord({
      repo: agent.session.did,
      collection: 'app.bsky.feed.post',
      record: postContent
    });
    console.log('Posted to Bluesky:', blueskyResult.data);

    return {
      ...event,
      userId: userId, // Use the correct userId from post.json
      blueskyPostUri: blueskyResult.data.uri,
      blueskyPostCid: blueskyResult.data.cid,
      postedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('Bluesky posting failed:', error);
    throw error;
  }
};