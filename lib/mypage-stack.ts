import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ParamsResourceStack } from './params-resource-stack';
import { ResourcePolicy } from './resource-policy';

export interface MyPageStackProps extends cdk.StackProps {
  stage: string;
  appName: string;
  paramsResourceStack: ParamsResourceStack;
}

export class MyPageStack extends cdk.Stack {
  public readonly postQueue: sqs.Queue;
  public readonly postDataBucket: s3.Bucket;
  public readonly provenanceBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: MyPageStackProps) {
    super(scope, id, props);

    // S3バケット: 投稿データ保存用
    this.postDataBucket = new s3.Bucket(this, 'PostDataBucket', {
      bucketName: `${ResourcePolicy.getResourceName(props.appName, props.stage, 'post-data')}-${this.account}-${this.region}`,
      ...ResourcePolicy.getS3BucketDefaults()
    });

    // S3バケット: 来歴ページ公開用（CloudFront経由でアクセス）
    this.provenanceBucket = new s3.Bucket(this, 'ProvenanceBucket', {
      bucketName: `${ResourcePolicy.getResourceName(props.appName, props.stage, 'provenance')}-${this.account}-${this.region}`,
      ...ResourcePolicy.getS3BucketDefaults(),
      websiteIndexDocument: 'index.html'
    });

    // SQS: 投稿処理キュー
    this.postQueue = new sqs.Queue(this, 'PostQueue', {
      queueName: ResourcePolicy.getResourceName(props.appName, props.stage, 'post-queue'),
      visibilityTimeout: cdk.Duration.minutes(15),
      retentionPeriod: cdk.Duration.days(14)
    });

    // Lambda実行ロール
    const lambdaRole = new iam.Role(this, 'MyPageLambdaRole', {
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
                's3:PutObject',
                's3:PutObjectAcl',
                's3:GetObject',
                's3:DeleteObject'
              ],
              resources: [
                `${props.paramsResourceStack.userInfoBucket.bucketArn}/*`,
                `${this.postDataBucket.bucketArn}/*`,
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
                this.postDataBucket.bucketArn,
                props.paramsResourceStack.provenancePublicBucket.bucketArn
              ]
            })
          ]
        }),
        SQSAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'sqs:SendMessage'
              ],
              resources: [this.postQueue.queueArn]
            })
          ]
        }),
        KMSAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'kms:Encrypt',
                'kms:Decrypt',
                'kms:ReEncrypt*',
                'kms:GenerateDataKey*',
                'kms:DescribeKey'
              ],
              resources: [props.paramsResourceStack.kmsKey.keyArn]
            })
          ]
        }),
        SSMAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'ssm:GetParameter'
              ],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/${props.appName}/${props.stage}/kms-key-id`
              ]
            })
          ]
        }),
        CognitoAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cognito-idp:GetUser'
              ],
              resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`]
            })
          ]
        })
      }
    });

    // マイページ Lambda関数のLogGroup
    const myPageLogGroup = ResourcePolicy.createLambdaLogGroup(
      this, 'MyPageFunctionLogGroup',
      ResourcePolicy.getResourceName(props.appName, props.stage, 'mypage'),
      props.stage
    );

    // マイページ Lambda関数
    const myPageFunction = new lambdaNodejs.NodejsFunction(this, 'MyPageFunction', {
      functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'mypage'),
      entry: 'lambda/mypage/index.ts',
      handler: 'handler',
      role: lambdaRole,
      ...ResourcePolicy.getLambdaDefaults(props.stage),
      logGroup: myPageLogGroup,
      environment: {
        APP_NAME: props.appName,
        USER_INFO_BUCKET: props.paramsResourceStack.userInfoBucket.bucketName,
        POST_DATA_BUCKET: this.postDataBucket.bucketName,
        POST_QUEUE_URL: this.postQueue.queueUrl,
        PROVENANCE_PUBLIC_BUCKET: props.paramsResourceStack.provenancePublicBucket.bucketName,
        STAGE: props.stage
      }
    });

    // API Gateway統合 - Low-levelリソースを使用
    const apiId = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-id`);
    const rootResourceId = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-root-resource-id`);

    // mypageリソースを作成
    const mypageResource = new apigateway.CfnResource(this, 'MypageResource', {
      restApiId: apiId,
      parentId: rootResourceId,
      pathPart: 'mypage'
    });

    // Lambda統合のURI
    const lambdaIntegrationUri = `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${myPageFunction.functionArn}/invocations`;

    // API Gateway メソッドを直接作成
    const mypageGetMethod = new apigateway.CfnMethod(this, 'MypageGetMethod', {
      restApiId: apiId,
      resourceId: mypageResource.ref,
      httpMethod: 'GET',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: lambdaIntegrationUri
      }
    });

    const mypagePostMethod = new apigateway.CfnMethod(this, 'MypagePostMethod', {
      restApiId: apiId,
      resourceId: mypageResource.ref,
      httpMethod: 'POST',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: lambdaIntegrationUri
      }
    });

    const mypageOptionsMethod = new apigateway.CfnMethod(this, 'MypageOptionsMethod', {
      restApiId: apiId,
      resourceId: mypageResource.ref,
      httpMethod: 'OPTIONS',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: lambdaIntegrationUri
      }
    });

    // /mypage/info リソースとメソッド
    const infoResource = new apigateway.CfnResource(this, 'InfoResource', {
      restApiId: apiId,
      parentId: mypageResource.ref,
      pathPart: 'info'
    });

    const infoGetMethod = new apigateway.CfnMethod(this, 'InfoGetMethod', {
      restApiId: apiId,
      resourceId: infoResource.ref,
      httpMethod: 'GET',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: lambdaIntegrationUri
      }
    });

    const infoOptionsMethod = new apigateway.CfnMethod(this, 'InfoOptionsMethod', {
      restApiId: apiId,
      resourceId: infoResource.ref,
      httpMethod: 'OPTIONS',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: lambdaIntegrationUri
      }
    });

    // /mypage/post リソースとメソッド
    const postResource = new apigateway.CfnResource(this, 'PostResource', {
      restApiId: apiId,
      parentId: mypageResource.ref,
      pathPart: 'post'
    });

    const postPostMethod = new apigateway.CfnMethod(this, 'PostPostMethod', {
      restApiId: apiId,
      resourceId: postResource.ref,
      httpMethod: 'POST',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: lambdaIntegrationUri
      }
    });

    const postOptionsMethod = new apigateway.CfnMethod(this, 'PostOptionsMethod', {
      restApiId: apiId,
      resourceId: postResource.ref,
      httpMethod: 'OPTIONS',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: lambdaIntegrationUri
      }
    });

    // Note: デプロイメントはauth-backend-stackで一元管理するため、ここでは作成しない

    // Lambda実行権限を追加
    myPageFunction.addPermission('AllowApiGatewayInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${apiId}/*/*`
    });

    // =============================================================================
    // API Gateway Deployment
    // =============================================================================

    // Note: 循環依存を回避するため、auth-backendのデプロイメントへの依存関係は追加しない
    // 代わりに、スタックレベルの依存関係（app.ts）で順序を制御

    // 出力
    const apiUrl = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-url`);
    new cdk.CfnOutput(this, 'MyPageUrl', {
      value: `${apiUrl}mypage`,
      exportName: `${props.appName}-${props.stage}-mypage-url`
    });

    new cdk.CfnOutput(this, 'PostQueueUrl', {
      value: this.postQueue.queueUrl,
      exportName: `${props.appName}-${props.stage}-post-queue-url`
    });

    new cdk.CfnOutput(this, 'PostQueueArn', {
      value: this.postQueue.queueArn,
      exportName: `${props.appName}-${props.stage}-post-queue-arn`
    });

    new cdk.CfnOutput(this, 'PostDataBucketName', {
      value: this.postDataBucket.bucketName,
      exportName: `${props.appName}-${props.stage}-post-data-bucket-name`
    });

    new cdk.CfnOutput(this, 'ProvenanceBucketName', {
      value: this.provenanceBucket.bucketName,
      exportName: `${props.appName}-${props.stage}-provenance-bucket-name`
    });
  }
}