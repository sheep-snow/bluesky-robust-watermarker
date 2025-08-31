import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as stepfunctionsTasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { MyPageStack } from './mypage-stack';
import { ParamsResourceStack } from './params-resource-stack';
import { ResourcePolicy } from './resource-policy';

export interface BatchStackProps extends cdk.StackProps {
  stage: string;
  appName: string;
  paramsResourceStack: ParamsResourceStack;
  myPageStack: MyPageStack;
}

export class BatchStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: BatchStackProps) {
    super(scope, id, props);

    // Lambda実行ロール
    const lambdaRole = new iam.Role(this, 'PostProcessLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject'
              ],
              resources: [
                `${props.paramsResourceStack.userInfoBucket.bucketArn}/*`,
                `arn:aws:s3:::${cdk.Fn.importValue(`${props.appName}-${props.stage}-post-data-bucket-name`)}/*`,
                `arn:aws:s3:::${cdk.Fn.importValue(`${props.appName}-${props.stage}-provenance-bucket-name`)}/*`,
                `${props.paramsResourceStack.provenancePublicBucket.bucketArn}/*`
              ]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:ListBucket'
              ],
              resources: [
                props.paramsResourceStack.userInfoBucket.bucketArn,
                `arn:aws:s3:::${cdk.Fn.importValue(`${props.appName}-${props.stage}-post-data-bucket-name`)}`,
                `arn:aws:s3:::${cdk.Fn.importValue(`${props.appName}-${props.stage}-provenance-bucket-name`)}`,
                props.paramsResourceStack.provenancePublicBucket.bucketArn
              ]
            })
          ]
        }),
        KMSAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'kms:Decrypt',
                'kms:DescribeKey'
              ],
              resources: [props.paramsResourceStack.kmsKey.keyArn]
            })
          ]
        }),
        CloudFrontAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cloudfront:CreateInvalidation'
              ],
              resources: [
                `arn:aws:cloudfront::${this.account}:distribution/*`
              ]
            })
          ]
        }),
        SSMAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'kms:Sign',
                'kms:GetPublicKey',
                'kms:DescribeKey'
              ],
              resources: ['*'], // スペクトラム透かし用KMSキーへのアクセス
              conditions: {
                StringEquals: {
                  'kms:KeyUsage': 'SIGN_VERIFY'
                }
              }
            })
          ]
        })
      }
    });

    // Watermark埋め込み関数 (Docker)
    const embedSpectrumWatermarkLogGroup = ResourcePolicy.createLambdaLogGroup(
      this, 'EmbedSpectrumWatermarkLogGroup',
      ResourcePolicy.getResourceName(props.appName, props.stage, 'embed-spectrum-watermark'),
      props.stage
    );

    const embedSpectrumWatermarkFunction = new lambda.DockerImageFunction(this, 'EmbedSpectrumWatermarkFunction', {
      functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'embed-spectrum-watermark'),
      code: lambda.DockerImageCode.fromImageAsset('.', {
        cmd: ['lambda.batch.embed_spectrum_watermark.handler'],
        file: 'Dockerfile'
      }),
      role: lambdaRole,
      timeout: cdk.Duration.minutes(10), // Longer timeout for spectrum watermarking
      memorySize: 1024, // More memory for image processing
      retryAttempts: 0,
      logGroup: embedSpectrumWatermarkLogGroup,
      environment: {
        APP_NAME: props.appName,
        POST_DATA_BUCKET: cdk.Fn.importValue(`${props.appName}-${props.stage}-post-data-bucket-name`),
        STAGE: props.stage
      }
    });

    // Lambda関数群
    const postToBlueskyLogGroup = ResourcePolicy.createLambdaLogGroup(
      this, 'PostToBlueskyLogGroup',
      ResourcePolicy.getResourceName(props.appName, props.stage, 'post-to-bluesky'),
      props.stage
    );

    const postToBlueskyFunction = new nodejs.NodejsFunction(this, 'PostToBlueskyFunction', {
      functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'post-to-bluesky'),
      entry: 'lambda/batch/post-to-bluesky.ts',
      handler: 'handler',
      role: lambdaRole,
      ...ResourcePolicy.getLambdaDefaults(props.stage),
      timeout: cdk.Duration.minutes(5),
      logGroup: postToBlueskyLogGroup,
      environment: {
        APP_NAME: props.appName,
        USER_INFO_BUCKET: props.paramsResourceStack.userInfoBucket.bucketName,
        POST_DATA_BUCKET: cdk.Fn.importValue(`${props.appName}-${props.stage}-post-data-bucket-name`),
        STAGE: props.stage
      }
    });

    const generateProvenanceLogGroup = ResourcePolicy.createLambdaLogGroup(
      this, 'GenerateProvenanceLogGroup',
      ResourcePolicy.getResourceName(props.appName, props.stage, 'generate-provenance'),
      props.stage
    );

    const generateProvenanceFunction = new nodejs.NodejsFunction(this, 'GenerateProvenanceFunction', {
      functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'generate-provenance'),
      entry: 'lambda/batch/generate-provenance.ts',
      handler: 'handler',
      role: lambdaRole,
      ...ResourcePolicy.getLambdaDefaults(props.stage),
      timeout: cdk.Duration.minutes(5),
      logGroup: generateProvenanceLogGroup,
      environment: {
        APP_NAME: props.appName,
        USER_INFO_BUCKET: props.paramsResourceStack.userInfoBucket.bucketName,
        POST_DATA_BUCKET: cdk.Fn.importValue(`${props.appName}-${props.stage}-post-data-bucket-name`),
        PROVENANCE_BUCKET: cdk.Fn.importValue(`${props.appName}-${props.stage}-provenance-bucket-name`),
        PROVENANCE_PUBLIC_BUCKET: props.paramsResourceStack.provenancePublicBucket.bucketName,
        STAGE: props.stage
      }
    });

    const updateUserListLogGroup = ResourcePolicy.createLambdaLogGroup(
      this, 'UpdateUserListLogGroup',
      ResourcePolicy.getResourceName(props.appName, props.stage, 'update-user-list'),
      props.stage
    );

    const updateUserListFunction = new nodejs.NodejsFunction(this, 'UpdateUserListFunction', {
      functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'update-user-list'),
      entry: 'lambda/batch/update-user-list.ts',
      handler: 'handler',
      role: lambdaRole,
      ...ResourcePolicy.getLambdaDefaults(props.stage),
      timeout: cdk.Duration.minutes(5),
      logGroup: updateUserListLogGroup,
      environment: {
        APP_NAME: props.appName,
        USER_INFO_BUCKET: props.paramsResourceStack.userInfoBucket.bucketName,
        POST_DATA_BUCKET: cdk.Fn.importValue(`${props.appName}-${props.stage}-post-data-bucket-name`),
        PROVENANCE_BUCKET: cdk.Fn.importValue(`${props.appName}-${props.stage}-provenance-bucket-name`),
        PROVENANCE_PUBLIC_BUCKET: props.paramsResourceStack.provenancePublicBucket.bucketName,
        CLOUDFRONT_DISTRIBUTION_ID: cdk.Fn.importValue(`${props.appName}-${props.stage}-distribution-id`),
        STAGE: props.stage
      }
    });

    // Step Functions定義
    const embedSpectrumWatermarkTask = new stepfunctionsTasks.LambdaInvoke(this, 'EmbedSpectrumWatermarkTask', {
      lambdaFunction: embedSpectrumWatermarkFunction,
      outputPath: '$.Payload'
    });

    const postToBlueskyTask = new stepfunctionsTasks.LambdaInvoke(this, 'PostToBlueskyTask', {
      lambdaFunction: postToBlueskyFunction,
      outputPath: '$.Payload'
    });

    const generateProvenanceTask = new stepfunctionsTasks.LambdaInvoke(this, 'GenerateProvenanceTask', {
      lambdaFunction: generateProvenanceFunction,
      outputPath: '$.Payload'
    });

    const updateUserListTask = new stepfunctionsTasks.LambdaInvoke(this, 'UpdateUserListTask', {
      lambdaFunction: updateUserListFunction,
      outputPath: '$.Payload'
    });

    // ワークフロー定義（スペクトラム透かし処理）
    const definition = embedSpectrumWatermarkTask
      .next(postToBlueskyTask)
      .next(generateProvenanceTask)
      .next(updateUserListTask);

    const stateMachine = new stepfunctions.StateMachine(this, 'PostProcessingWorkflow', {
      stateMachineName: ResourcePolicy.getResourceName(props.appName, props.stage, 'post-processing'),
      definition,
      timeout: cdk.Duration.minutes(30)
    });

    // SQSトリガーLambda
    const triggerLogGroup = ResourcePolicy.createLambdaLogGroup(
      this, 'TriggerLogGroup',
      ResourcePolicy.getResourceName(props.appName, props.stage, 'post-trigger'),
      props.stage
    );

    const triggerFunction = new nodejs.NodejsFunction(this, 'TriggerFunction', {
      functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'post-trigger'),
      entry: 'lambda/batch/trigger.ts',
      handler: 'handler',
      ...ResourcePolicy.getLambdaDefaults(props.stage),
      timeout: cdk.Duration.minutes(5),
      logGroup: triggerLogGroup,
      environment: {
        APP_NAME: props.appName,
        STATE_MACHINE_ARN: stateMachine.stateMachineArn
      }
    });

    // Step Functions実行権限
    stateMachine.grantStartExecution(triggerFunction);

    // SQSイベントソース
    const postQueueArn = cdk.Fn.importValue(`${props.appName}-${props.stage}-post-queue-arn`);
    const postQueue = sqs.Queue.fromQueueArn(this, 'ImportedPostQueue', postQueueArn);
    triggerFunction.addEventSource(new eventsources.SqsEventSource(postQueue, {
      batchSize: 1
    }));

    // 出力
    new cdk.CfnOutput(this, 'PostProcessingWorkflowArn', {
      value: stateMachine.stateMachineArn,
      exportName: `${props.appName}-${props.stage}-post-processing-workflow-arn`
    });
  }
}