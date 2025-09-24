import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

export interface UserInfo {
  userId: string;
  blueskyUserId: string;
  encryptedBlueskyAppPassword: string;
  provenancePageId: string;
  updatedAt: string;
  validatedAt: string;
  createdAt: string;
  deletedAt?: string;
}

export class UserDB {
  private tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  async getUserInfo(userId: string): Promise<UserInfo | null> {
    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: { userId }
      });
      
      const result = await docClient.send(command);
      const item = result.Item as UserInfo;
      
      // Return null if item is logically deleted
      if (item && item.deletedAt) {
        return null;
      }
      
      return item || null;
    } catch (error) {
      console.error('Error getting user info:', error);
      throw error;
    }
  }

  async saveUserInfo(userInfo: UserInfo): Promise<void> {
    try {
      const command = new PutCommand({
        TableName: this.tableName,
        Item: userInfo
      });
      
      await docClient.send(command);
    } catch (error) {
      console.error('Error saving user info:', error);
      throw error;
    }
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      const command = new PutCommand({
        TableName: this.tableName,
        Item: {
          userId,
          deletedAt: new Date().toISOString()
        }
      });
      
      await docClient.send(command);
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
  }
}