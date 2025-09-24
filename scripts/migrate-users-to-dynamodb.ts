#!/usr/bin/env node

/**
 * Migration script to move user data from S3 to DynamoDB
 * 
 * Usage:
 * npm run migrate-users -- --stage dev
 * npm run migrate-users -- --stage prd
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

async function migrateUsers() {
  console.log(`Starting migration for stage: ${stage}`);
  
  const userInfoBucketName = `${APP_NAME}-${stage}-user-info-${process.env.AWS_ACCOUNT_ID}-${AWS_REGION}`;
  const usersTableName = `${APP_NAME}-${stage}-users`;
  
  console.log(`Source S3 bucket: ${userInfoBucketName}`);
  console.log(`Target DynamoDB table: ${usersTableName}`);
  
  try {
    // List all user files in S3
    const listCommand = new ListObjectsV2Command({
      Bucket: userInfoBucketName
    });
    
    const listResult = await s3Client.send(listCommand);
    
    if (!listResult.Contents || listResult.Contents.length === 0) {
      console.log('No user files found in S3 bucket');
      return;
    }
    
    console.log(`Found ${listResult.Contents.length} user files to migrate`);
    
    let migratedCount = 0;
    let errorCount = 0;
    
    for (const object of listResult.Contents) {
      if (!object.Key || !object.Key.endsWith('.json')) {
        continue;
      }
      
      const userId = object.Key.replace('.json', '');
      console.log(`Migrating user: ${userId}`);
      
      try {
        // Get user data from S3
        const getCommand = new GetObjectCommand({
          Bucket: userInfoBucketName,
          Key: object.Key
        });
        
        const result = await s3Client.send(getCommand);
        const userData = JSON.parse(await result.Body!.transformToString());
        
        // Add userId to the data
        const userRecord = {
          userId,
          ...userData
        };
        
        // Save to DynamoDB
        const putCommand = new PutCommand({
          TableName: usersTableName,
          Item: userRecord
        });
        
        await docClient.send(putCommand);
        
        console.log(`✅ Successfully migrated user: ${userId}`);
        migratedCount++;
        
      } catch (error) {
        console.error(`❌ Failed to migrate user ${userId}:`, error);
        errorCount++;
      }
    }
    
    console.log('\n=== Migration Summary ===');
    console.log(`Total files processed: ${listResult.Contents.length}`);
    console.log(`Successfully migrated: ${migratedCount}`);
    console.log(`Errors: ${errorCount}`);
    
    if (errorCount === 0) {
      console.log('\n🎉 Migration completed successfully!');
      console.log('\nNext steps:');
      console.log('1. Deploy the updated CDK stacks');
      console.log('2. Test the application to ensure everything works');
      console.log('3. Consider removing the S3 user-info bucket after confirming everything works');
    } else {
      console.log('\n⚠️  Migration completed with errors. Please review the failed migrations.');
    }
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrateUsers().catch(console.error);