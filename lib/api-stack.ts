import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { ParamsResourceStack } from './params-resource-stack';
import { ResourcePolicy } from './resource-policy';

export interface ApiStackProps extends cdk.StackProps {
  stage: string;
  appName: string;
  paramsResourceStack: ParamsResourceStack;
}

export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // API Gateway
    const apiId = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-id`);
    const rootResourceId = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-root-resource-id`);

    // /api リソース
    const apiResource = new apigateway.CfnResource(this, 'ApiResource', {
      restApiId: apiId,
      parentId: rootResourceId,
      pathPart: 'api'
    });

    // Lambda実行ロール
    const lambdaRole = new iam.Role(this, 'ApiLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:PutObject'],
              resources: [`${props.paramsResourceStack.userInfoBucket.bucketArn}/*`]
            })
          ]
        }),
        KMSAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['kms:Encrypt', 'kms:Decrypt'],
              resources: [props.paramsResourceStack.kmsKey.keyArn]
            })
          ]
        }),
        SSMAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['ssm:GetParameter'],
              resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${props.appName}/${props.stage}/kms-key-id`]
            })
          ]
        })
      }
    });

    // Auth API Lambda
    const authFunction = new lambdaNodejs.NodejsFunction(this, 'AuthFunction', {
      functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'api-auth'),
      entry: 'lambda/api/auth/index.ts',
      handler: 'handler',
      role: lambdaRole,
      environment: {
        APP_NAME: props.appName,
        STAGE: props.stage,
        USER_INFO_BUCKET: props.paramsResourceStack.userInfoBucket.bucketName
      },
      ...ResourcePolicy.getLambdaDefaults(props.stage)
    });

    // Bluesky API Lambda
    const blueskyFunction = new lambdaNodejs.NodejsFunction(this, 'BlueskyFunction', {
      functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'api-bluesky'),
      entry: 'lambda/api/bluesky/index.ts',
      handler: 'handler',
      role: lambdaRole,
      environment: {
        APP_NAME: props.appName,
        STAGE: props.stage,
        USER_INFO_BUCKET: props.paramsResourceStack.userInfoBucket.bucketName
      },
      ...ResourcePolicy.getLambdaDefaults(props.stage)
    });

    // API Gateway統合
    this.createApiIntegration(apiId, apiResource.ref, 'auth', authFunction);
    this.createApiIntegration(apiId, apiResource.ref, 'bluesky', blueskyFunction);

    // Lambda実行権限
    [authFunction, blueskyFunction].forEach(func => {
      func.addPermission('AllowApiGatewayInvoke', {
        principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
        sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${apiId}/*/*`
      });
    });
  }

  private createApiIntegration(apiId: string, parentResourceId: string, pathPart: string, lambdaFunction: lambdaNodejs.NodejsFunction) {
    const resource = new apigateway.CfnResource(this, `${pathPart}Resource`, {
      restApiId: apiId,
      parentId: parentResourceId,
      pathPart
    });

    const proxyResource = new apigateway.CfnResource(this, `${pathPart}ProxyResource`, {
      restApiId: apiId,
      parentId: resource.ref,
      pathPart: '{proxy+}'
    });

    const lambdaIntegrationUri = `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${lambdaFunction.functionArn}/invocations`;

    new apigateway.CfnMethod(this, `${pathPart}ProxyMethod`, {
      restApiId: apiId,
      resourceId: proxyResource.ref,
      httpMethod: 'ANY',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: lambdaIntegrationUri
      }
    });

    new apigateway.CfnMethod(this, `${pathPart}OptionsMethod`, {
      restApiId: apiId,
      resourceId: proxyResource.ref,
      httpMethod: 'OPTIONS',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: lambdaIntegrationUri
      }
    });
  }
}