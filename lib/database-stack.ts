import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface DatabaseStackProps extends cdk.StackProps {
  stage: string;
  appName: string;
}

export class DatabaseStack extends cdk.Stack {
  public readonly processingProgressTable: dynamodb.Table;

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

    // 出力
    new cdk.CfnOutput(this, 'ProcessingProgressTableName', {
      value: this.processingProgressTable.tableName,
      exportName: `${props.appName}-${props.stage}-processing-progress-table-name`
    });

    new cdk.CfnOutput(this, 'ProcessingProgressTableArn', {
      value: this.processingProgressTable.tableArn,
      exportName: `${props.appName}-${props.stage}-processing-progress-table-arn`
    });
  }
}