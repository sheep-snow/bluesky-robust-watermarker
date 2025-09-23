import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { ParamsResourceStack } from './params-resource-stack';
import { DatabaseStack } from './database-stack';
import { ResourcePolicy } from './resource-policy';

export interface ApiStackProps extends cdk.StackProps {
  stage: string;
  appName: string;
  paramsResourceStack: ParamsResourceStack;
  databaseStack: DatabaseStack;
  userPoolClientId?: string;
  domainName?: string;
  postQueueUrl?: string;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // API Gateway
    this.api = new apigateway.RestApi(this, 'Api', {
      restApiName: `${props.appName}-${props.stage}-api`,
      description: `${props.appName} API for ${props.stage}`,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization']
      }
    });

    // /api リソース
    const apiResource = this.api.root.addResource('api');

    // Home API Lambda
    const homeApiFunction = new lambdaNodejs.NodejsFunction(this, 'HomeApiFunction', {
      functionName: `${props.appName}-${props.stage}-home-api`,
      entry: 'lambda/api/home/index.ts',
      handler: 'handler',
      environment: {
        APP_NAME: props.appName
      },
      ...ResourcePolicy.getLambdaDefaults(props.stage)
    });

    // Home API統合
    apiResource.addMethod('GET', new apigateway.LambdaIntegration(homeApiFunction));

    // Login API Lambda
    const loginApiFunction = new lambdaNodejs.NodejsFunction(this, 'LoginApiFunction', {
      functionName: `${props.appName}-${props.stage}-login-api`,
      entry: 'lambda/api/login/index.ts',
      handler: 'handler',
      environment: {
        APP_NAME: props.appName,
        COGNITO_DOMAIN: `https://${props.appName}-${props.stage}.auth.${this.region}.amazoncognito.com`,
        USER_POOL_CLIENT_ID: props.userPoolClientId || (() => { throw new Error('userPoolClientId is required'); })(),
        DOMAIN_NAME: props.domainName || (() => { throw new Error('domainName is required'); })()
      },
      ...ResourcePolicy.getLambdaDefaults(props.stage)
    });

    // Signup API Lambda
    const signupApiFunction = new lambdaNodejs.NodejsFunction(this, 'SignupApiFunction', {
      functionName: `${props.appName}-${props.stage}-signup-api`,
      entry: 'lambda/api/signup/index.ts',
      handler: 'handler',
      environment: {
        APP_NAME: props.appName,
        COGNITO_DOMAIN: `https://${props.appName}-${props.stage}.auth.${this.region}.amazoncognito.com`,
        USER_POOL_CLIENT_ID: props.userPoolClientId || (() => { throw new Error('userPoolClientId is required'); })(),
        DOMAIN_NAME: props.domainName || (() => { throw new Error('domainName is required'); })()
      },
      ...ResourcePolicy.getLambdaDefaults(props.stage)
    });

    // MyPage API Lambda
    const mypageApiFunction = new lambdaNodejs.NodejsFunction(this, 'MypageApiFunction', {
      functionName: `${props.appName}-${props.stage}-mypage-api`,
      entry: 'lambda/api/mypage/index.ts',
      handler: 'handler',
      environment: {
        APP_NAME: props.appName,
        STAGE: props.stage,
        USER_INFO_BUCKET: props.paramsResourceStack.userInfoBucket.bucketName,
        POST_DATA_BUCKET: props.paramsResourceStack.provenanceInfoBucket.bucketName,
        POST_QUEUE_URL: props.postQueueUrl || (() => { throw new Error('postQueueUrl is required'); })(),
        PROVENANCE_PUBLIC_BUCKET: props.paramsResourceStack.provenancePublicBucket.bucketName
      },
      ...ResourcePolicy.getLambdaDefaults(props.stage)
    });

    // Verify Watermark API Lambda
    const verifyWatermarkApiFunction = new cdk.aws_lambda.Function(this, 'VerifyWatermarkApiFunction', {
      functionName: `${props.appName}-${props.stage}-verify-watermark-api`,
      runtime: cdk.aws_lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: cdk.aws_lambda.Code.fromAsset('lambda/api/verify-watermark'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        APP_NAME: props.appName,
        DOMAIN_NAME: props.domainName || (() => { throw new Error('domainName is required'); })(),
        CLOUDFRONT_DOMAIN: props.domainName || (() => { throw new Error('domainName is required'); })(),
        VERIFICATION_RESULTS_TABLE: props.databaseStack.verificationResultsTable.tableName
      }
    });

    // Grant permissions
    props.paramsResourceStack.userInfoBucket.grantReadWrite(mypageApiFunction);
    props.paramsResourceStack.provenanceInfoBucket.grantReadWrite(mypageApiFunction);
    props.paramsResourceStack.provenancePublicBucket.grantReadWrite(mypageApiFunction);
    props.paramsResourceStack.kmsKey.grantEncryptDecrypt(mypageApiFunction);
    
    // Grant SSM parameter access
    mypageApiFunction.addToRolePolicy(new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${props.appName}/${props.stage}/kms-key-id`]
    }));

    // Login/Signup API統合
    const loginResource = apiResource.addResource('login');
    const signupResource = apiResource.addResource('signup');
    loginResource.addMethod('GET', new apigateway.LambdaIntegration(loginApiFunction));
    signupResource.addMethod('GET', new apigateway.LambdaIntegration(signupApiFunction));

    // MyPage API統合
    const mypageResource = apiResource.addResource('mypage');
    mypageResource.addMethod('GET', new apigateway.LambdaIntegration(mypageApiFunction));
    mypageResource.addMethod('POST', new apigateway.LambdaIntegration(mypageApiFunction));
    mypageResource.addResource('{proxy+}').addMethod('ANY', new apigateway.LambdaIntegration(mypageApiFunction));

    // Verify Watermark API統合
    const verifyResource = apiResource.addResource('verify-watermark');
    verifyResource.addMethod('GET', new apigateway.LambdaIntegration(verifyWatermarkApiFunction));
    verifyResource.addMethod('POST', new apigateway.LambdaIntegration(verifyWatermarkApiFunction));

    // 出力
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      exportName: `${props.appName}-${props.stage}-api-url`
    });
  }
}