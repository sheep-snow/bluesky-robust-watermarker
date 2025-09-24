import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export interface PostInfo {
  postId: string;
  userId: string;
  blueskyUserId: string;
  text?: string;
  imageMetadata?: any[];
  contentLabels?: string[];
  blueskyPostUri?: string;
  postedAt: string;
  createdAt: string;
  provenancePageId?: string;
  deletedAt?: string;
}

export class PostDB {
  private tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  async getPost(postId: string): Promise<PostInfo | null> {
    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: { postId }
      });
      
      const result = await docClient.send(command);
      const item = result.Item as PostInfo;
      
      // Return null if item is logically deleted
      if (item && item.deletedAt) {
        return null;
      }
      
      return item || null;
    } catch (error) {
      console.error('Error getting post:', error);
      throw error;
    }
  }

  async savePost(postInfo: PostInfo): Promise<void> {
    try {
      const command = new PutCommand({
        TableName: this.tableName,
        Item: postInfo
      });
      
      await docClient.send(command);
    } catch (error) {
      console.error('Error saving post:', error);
      throw error;
    }
  }

  async getUserPosts(userId: string): Promise<PostInfo[]> {
    try {
      const command = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'UserIdIndex',
        KeyConditionExpression: 'userId = :userId',
        FilterExpression: 'attribute_not_exists(deletedAt)',
        ExpressionAttributeValues: {
          ':userId': userId
        },
        ScanIndexForward: false // Sort by createdAt descending
      });
      
      const result = await docClient.send(command);
      return result.Items as PostInfo[] || [];
    } catch (error) {
      console.error('Error getting user posts:', error);
      throw error;
    }
  }

  async deletePost(postId: string): Promise<void> {
    try {
      const command = new PutCommand({
        TableName: this.tableName,
        Item: {
          postId,
          deletedAt: new Date().toISOString()
        }
      });
      
      await docClient.send(command);
    } catch (error) {
      console.error('Error deleting post:', error);
      throw error;
    }
  }
}