// Force cache invalidation - updated at 10:47
import { SQSEvent } from 'aws-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

const stepFunctionsClient = new SFNClient({ region: process.env.AWS_REGION });

export const handler = async (event: SQSEvent) => {
  console.log('SQS trigger received:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    try {
      const message = JSON.parse(record.body);
      console.log('Processing message:', message);

      const executionInput = {
        postId: message.postId,
        userId: message.userId,
        bucket: message.bucket,
        timestamp: message.timestamp
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