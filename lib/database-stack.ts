import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface DatabaseStackProps extends cdk.StackProps {
  stage: string;
  appName: string;
}

export class DatabaseStack extends cdk.Stack {
  public readonly processingProgressTable: dynamodb.Table;
  public readonly usersTable: dynamodb.Table;
  public readonly postsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    // 処理進捗管理テーブル
    this.processingProgressTable = new dynamodb.Table(this, 'ProcessingProgressTable', {
      tableName: `${props.appName}-${props.stage}-processing-progress`,
      partitionKey: { name: 'task_id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl' // 24時間後に自動削除
    });

    // ユーザー情報テーブル
    this.usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: `${props.appName}-${props.stage}-users`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // 投稿情報テーブル
    this.postsTable = new dynamodb.Table(this, 'PostsTable', {
      tableName: `${props.appName}-${props.stage}-posts`,
      partitionKey: { name: 'postId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // GSI for querying posts by userId
    this.postsTable.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING }
    });

    // 出力
    new cdk.CfnOutput(this, 'ProcessingProgressTableName', {
      value: this.processingProgressTable.tableName,
      exportName: `${props.appName}-${props.stage}-processing-progress-table-name`
    });

    new cdk.CfnOutput(this, 'ProcessingProgressTableArn', {
      value: this.processingProgressTable.tableArn,
      exportName: `${props.appName}-${props.stage}-processing-progress-table-arn`
    });

    new cdk.CfnOutput(this, 'UsersTableName', {
      value: this.usersTable.tableName,
      exportName: `${props.appName}-${props.stage}-users-table-name`
    });

    new cdk.CfnOutput(this, 'UsersTableArn', {
      value: this.usersTable.tableArn,
      exportName: `${props.appName}-${props.stage}-users-table-arn`
    });

    new cdk.CfnOutput(this, 'PostsTableName', {
      value: this.postsTable.tableName,
      exportName: `${props.appName}-${props.stage}-posts-table-name`
    });

    new cdk.CfnOutput(this, 'PostsTableArn', {
      value: this.postsTable.tableArn,
      exportName: `${props.appName}-${props.stage}-posts-table-arn`
    });
  }
}