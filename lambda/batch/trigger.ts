// Force cache invalidation - updated at 10:47
import { SQSEvent } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION });

const initializeProgress = async (taskId: string) => {
  try {
    const tableName = process.env.PROCESSING_PROGRESS_TABLE_NAME;
    if (!tableName) return;
    
    await dynamodb.send(new PutItemCommand({
      TableName: tableName,
      Item: {
        task_id: { S: taskId },
        status: { S: 'starting' },
        progress: { N: '0' },
        message: { S: 'Processing started' },
        updated_at: { S: Math.floor(Date.now() / 1000).toString() },
        ttl: { N: (Math.floor(Date.now() / 1000) + 86400).toString() }
      }
    }));
  } catch (e) {
    console.error('Failed to initialize progress:', e);
  }
};

const stepFunctionsClient = new SFNClient({ region: process.env.AWS_REGION });
const s3Client = new S3Client({ region: process.env.AWS_REGION });

export const handler = async (event: SQSEvent) => {
  console.log('SQS trigger received:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      console.log('Processing message:', message);

      // Get post data to check for images
      let imageMetadata = [];
      try {
        const postCommand = new GetObjectCommand({
          Bucket: message.bucket,
          Key: `${message.postId}/post.json`
        });
        const postResult = await s3Client.send(postCommand);
        const postDataString = await postResult.Body!.transformToString();
        const postData = JSON.parse(postDataString);
        console.log('Post data loaded, imageMetadata count:', postData.imageMetadata?.length || 0);
        
        if (postData.imageMetadata && postData.imageMetadata.length > 0) {
          imageMetadata = postData.imageMetadata;
        }
      } catch (error) {
        console.log('Failed to load post data, proceeding without images:', error);
      }

      // Initialize progress tracking
      await initializeProgress(message.postId);
      
      const executionInput = {
        postId: message.postId,
        userId: message.userId,
        bucket: message.bucket,
        timestamp: message.timestamp,
        imageMetadata: imageMetadata
      };

      const command = new StartExecutionCommand({
        stateMachineArn: process.env.STATE_MACHINE_ARN,
        name: `post-${message.postId}-${Date.now()}`,
        input: JSON.stringify(executionInput)
      });

      const result = await stepFunctionsClient.send(command);
      console.log('Started Step Functions execution:', result.executionArn);

    } catch (error) {
      console.error('Failed to process SQS message:', error);
      throw error;
    }
  }

  return { statusCode: 200, body: 'Processing completed' };
};