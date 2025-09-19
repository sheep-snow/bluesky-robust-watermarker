import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const dynamodb = new DynamoDBClient({});
const TABLE_NAME = process.env.PROCESSING_PROGRESS_TABLE_NAME!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const taskId = event.pathParameters?.taskId;
    if (!taskId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Task ID is required' })
      };
    }

    const result = await dynamodb.send(new GetItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ task_id: taskId })
    }));

    if (!result.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Task not found' })
      };
    }

    const progress = unmarshall(result.Item);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        taskId: progress.task_id,
        status: progress.status,
        progress: progress.progress || 0,
        message: progress.message || '',
        error: progress.error,
        completed: progress.status === 'completed' || progress.status === 'error'
      })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};