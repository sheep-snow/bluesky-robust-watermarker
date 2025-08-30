import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { EventBridgeEvent } from 'aws-lambda';

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const sqsClient = new SQSClient({ region: process.env.AWS_REGION });

export const handler = async (event: EventBridgeEvent<string, any>) => {
  console.log('Starting batch processing...');

  try {
    const listCommand = new ListObjectsV2Command({
      Bucket: process.env.USER_INFO_BUCKET
    });

    const response = await s3Client.send(listCommand);
    const objects = response.Contents || [];

    console.log(`Found ${objects.length} user info files`);

    let processedCount = 0;

    for (const object of objects) {
      if (object.Key && object.Key.endsWith('.json')) {
        // ファイル名からユーザーIDを抽出 (例: test-user.bsky.social.json -> test-user.bsky.social)
        const userId = object.Key.replace('.json', '');

        // MonitoringWorkflowが期待する形式でメッセージを送信
        const message = {
          userId: userId,
          timestamp: new Date().toISOString(),
          source: 'batch-scheduler'
        };

        const sendCommand = new SendMessageCommand({
          QueueUrl: process.env.MONITORING_QUEUE_URL,
          MessageBody: JSON.stringify(message)
        });

        await sqsClient.send(sendCommand);
        console.log(`Sent monitoring message for user: ${userId}`);
        processedCount++;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Batch processing completed',
        processedFiles: processedCount
      })
    };
  } catch (error) {
    console.error('Batch processing failed:', error);
    throw error;
  }
};