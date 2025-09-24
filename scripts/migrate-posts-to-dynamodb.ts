#!/usr/bin/env node

/**
 * Migration script to move post data from S3 to DynamoDB
 * 
 * Usage:
 * npm run migrate-posts -- --stage dev
 * npm run migrate-posts -- --stage prd
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const args = process.argv.slice(2);
const stageIndex = args.indexOf('--stage');
const stage = stageIndex !== -1 ? args[stageIndex + 1] : 'dev';

if (!stage) {
  console.error('Please specify stage: --stage dev or --stage prd');
  process.exit(1);
}

const APP_NAME = process.env.APP_NAME || 'brw';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

const s3Client = new S3Client({ region: AWS_REGION });
const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

async function migratePosts() {
  console.log(`Starting post migration for stage: ${stage}`);
  
  const postDataBucketName = `${APP_NAME}-${stage}-post-data-${process.env.AWS_ACCOUNT_ID}-${AWS_REGION}`;
  const userInfoBucketName = `${APP_NAME}-${stage}-user-info-${process.env.AWS_ACCOUNT_ID}-${AWS_REGION}`;
  const postsTableName = `${APP_NAME}-${stage}-posts`;
  
  console.log(`Source S3 bucket: ${postDataBucketName}`);
  console.log(`Target DynamoDB table: ${postsTableName}`);
  
  try {
    // List all post directories in S3
    const listCommand = new ListObjectsV2Command({
      Bucket: postDataBucketName,
      Delimiter: '/'
    });
    
    const listResult = await s3Client.send(listCommand);
    
    if (!listResult.CommonPrefixes || listResult.CommonPrefixes.length === 0) {
      console.log('No post directories found in S3 bucket');
      return;
    }
    
    console.log(`Found ${listResult.CommonPrefixes.length} post directories to migrate`);
    
    let migratedCount = 0;
    let errorCount = 0;
    
    for (const prefix of listResult.CommonPrefixes) {
      if (!prefix.Prefix) continue;
      
      const postId = prefix.Prefix.replace('/', '');
      console.log(`Migrating post: ${postId}`);
      
      try {
        // Get post data from S3
        const postCommand = new GetObjectCommand({
          Bucket: postDataBucketName,
          Key: `${postId}/post.json`
        });
        
        const postResult = await s3Client.send(postCommand);
        const postData = JSON.parse(await postResult.Body!.transformToString());
        
        // Get user info to get blueskyUserId
        let blueskyUserId = 'unknown';
        try {
          const userCommand = new GetObjectCommand({
            Bucket: userInfoBucketName,
            Key: `${postData.userId}.json`
          });
          const userResult = await s3Client.send(userCommand);
          const userData = JSON.parse(await userResult.Body!.transformToString());
          blueskyUserId = userData.blueskyUserId;
        } catch (userError) {
          console.warn(`Could not get user info for ${postData.userId}, using 'unknown'`);
        }
        
        // Create post record for DynamoDB
        const postRecord = {
          postId,
          userId: postData.userId,
          blueskyUserId,
          text: postData.text,
          imageMetadata: postData.imageMetadata,
          contentLabels: postData.contentLabels,
          createdAt: postData.createdAt,
          postedAt: postData.createdAt // Use createdAt as fallback
        };
        
        // Save to DynamoDB
        const putCommand = new PutCommand({
          TableName: postsTableName,
          Item: postRecord
        });
        
        await docClient.send(putCommand);
        
        console.log(`✅ Successfully migrated post: ${postId}`);
        migratedCount++;
        
      } catch (error) {
        console.error(`❌ Failed to migrate post ${postId}:`, error);
        errorCount++;
      }
    }
    
    console.log('\n=== Migration Summary ===');
    console.log(`Total posts processed: ${listResult.CommonPrefixes.length}`);
    console.log(`Successfully migrated: ${migratedCount}`);
    console.log(`Errors: ${errorCount}`);
    
    if (errorCount === 0) {
      console.log('\n🎉 Post migration completed successfully!');
    } else {
      console.log('\n⚠️  Post migration completed with errors. Please review the failed migrations.');
    }
    
  } catch (error) {
    console.error('Post migration failed:', error);
    process.exit(1);
  }
}

migratePosts().catch(console.error);