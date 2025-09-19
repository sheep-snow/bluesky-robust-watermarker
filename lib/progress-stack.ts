import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { DatabaseStack } from './database-stack';
import { ParamsResourceStack } from './params-resource-stack';
import { ResourcePolicy } from './resource-policy';

export interface ProgressStackProps extends cdk.StackProps {
  stage: string;
  appName: string;
  paramsResourceStack: ParamsResourceStack;
  databaseStack: DatabaseStack;
}

export class ProgressStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ProgressStackProps) {
    super(scope, id, props);

    // Lambda実行ロール
    const lambdaRole = new iam.Role(this, 'ProgressLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['dynamodb:GetItem'],
              resources: [props.databaseStack.processingProgressTable.tableArn]
            })
          ]
        })
      }
    });

    // 進捗確認Lambda関数
    const progressLogGroup = ResourcePolicy.createLambdaLogGroup(
      this, 'ProgressLogGroup',
      ResourcePolicy.getResourceName(props.appName, props.stage, 'progress'),
      props.stage
    );

    const progressFunction = new lambda.NodejsFunction(this, 'ProgressFunction', {
      functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'progress'),
      entry: 'lambda/progress/index.ts',
      handler: 'handler',
      role: lambdaRole,
      ...ResourcePolicy.getLambdaDefaults(props.stage),
      logGroup: progressLogGroup,
      retryAttempts: 0,
      environment: {
        PROCESSING_PROGRESS_TABLE_NAME: props.databaseStack.processingProgressTable.tableName
      }
    });

    // API Gateway統合
    const api = apigateway.RestApi.fromRestApiAttributes(this, 'ImportedApi', {
      restApiId: cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-id`),
      rootResourceId: cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-root-resource-id`)
    });

    const progressIntegration = new apigateway.LambdaIntegration(progressFunction);

    // /progress/{taskId} エンドポイント
    const progressResource = api.root.addResource('progress');
    const taskIdResource = progressResource.addResource('{taskId}');
    taskIdResource.addMethod('GET', progressIntegration);
    taskIdResource.addMethod('OPTIONS', progressIntegration);

    // API Gateway再デプロイ
    new apigateway.Deployment(this, 'ProgressDeployment', {
      api: api,
      description: `Progress API deployment ${new Date().toISOString()}`
    });

    // 出力
    const apiUrl = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-url`);
    new cdk.CfnOutput(this, 'ProgressUrl', {
      value: `${apiUrl}progress/{taskId}`,
      exportName: `${props.appName}-${props.stage}-progress-url`
    });
  }
}