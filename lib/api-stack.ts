import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
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
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // API Gateway
    this.api = new apigateway.RestApi(this, 'Api', {
      restApiName: `${props.appName}-${props.stage}-api`,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization']
      }
    });

    // Auth endpoints
    const authResource = this.api.root.addResource('auth');
    this.addAuthEndpoints(authResource, props);

    // MyPage endpoints
    const mypageResource = this.api.root.addResource('mypage');
    this.addMypageEndpoints(mypageResource, props);

    // Verify endpoints
    const verifyResource = this.api.root.addResource('verify');
    this.addVerifyEndpoints(verifyResource, props);

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      exportName: `${props.appName}-${props.stage}-api-url`
    });
  }

  private addAuthEndpoints(resource: apigateway.Resource, props: ApiStackProps) {
    const callbackFunction = new lambdaNodejs.NodejsFunction(this, 'AuthCallbackFunction', {
      functionName: `${props.appName}-${props.stage}-auth-callback`,
      entry: 'lambda/api/auth/callback.ts',
      ...ResourcePolicy.getLambdaDefaults(props.stage)
    });

    resource.addResource('callback').addMethod('GET', new apigateway.LambdaIntegration(callbackFunction));
  }

  private addMypageEndpoints(resource: apigateway.Resource, props: ApiStackProps) {
    const configFunction = new lambdaNodejs.NodejsFunction(this, 'MypageConfigFunction', {
      functionName: `${props.appName}-${props.stage}-mypage-config`,
      entry: 'lambda/api/mypage/config.ts',
      ...ResourcePolicy.getLambdaDefaults(props.stage)
    });

    resource.addResource('config').addMethod('POST', new apigateway.LambdaIntegration(configFunction));
  }

  private addVerifyEndpoints(resource: apigateway.Resource, props: ApiStackProps) {
    const watermarkFunction = new lambdaNodejs.NodejsFunction(this, 'VerifyWatermarkFunction', {
      functionName: `${props.appName}-${props.stage}-verify-watermark`,
      entry: 'lambda/api/verify/watermark.ts',
      ...ResourcePolicy.getLambdaDefaults(props.stage)
    });

    resource.addResource('watermark').addMethod('POST', new apigateway.LambdaIntegration(watermarkFunction));
  }
}