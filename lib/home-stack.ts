import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { ParamsResourceStack } from './params-resource-stack';
import { ResourcePolicy } from './resource-policy';

export interface HomeStackProps extends cdk.StackProps {
  stage: string;
  appName: string;
  paramsResourceStack: ParamsResourceStack;
}

export class HomeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: HomeStackProps) {
    super(scope, id, props);

    // Home Lambda Function
    const homeLogGroup = ResourcePolicy.createLambdaLogGroup(
      this, 'HomeFunctionLogGroup',
      ResourcePolicy.getResourceName(props.appName, props.stage, 'home'),
      props.stage
    );
    const homeFunction = new lambdaNodejs.NodejsFunction(this, 'HomeFunction', {
      functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'home'),
      entry: 'lambda/home/index.ts',
      handler: 'handler',
      environment: {
        APP_NAME: props.appName
      },
      logGroup: homeLogGroup,
      ...ResourcePolicy.getLambdaDefaults(props.stage)
      , retryAttempts: 0
    });

    // API Gateway Integration - Low-levelリソースを使用
    const apiId = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-id`);
    const rootResourceId = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-root-resource-id`);

    // Lambda統合のURI
    const lambdaIntegrationUri = `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${homeFunction.functionArn}/invocations`;

    // API Gateway メソッドを直接作成
    const homeMethod = new apigateway.CfnMethod(this, 'HomeMethod', {
      restApiId: apiId,
      resourceId: rootResourceId,
      httpMethod: 'GET',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: lambdaIntegrationUri
      }
    });

    // API Gateway Deploymentでprodステージに変更を反映
    const deployment = new apigateway.CfnDeployment(this, 'HomeApiDeployment', {
      restApiId: apiId,
      stageName: 'prod',
      description: `Deploy home endpoint changes to prod stage - ${new Date().toISOString()}`
    });

    // メソッド作成後にデプロイメントを実行
    deployment.addDependency(homeMethod);

    // Lambda実行権限を追加
    homeFunction.addPermission('AllowApiGatewayInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${apiId}/*/*/*`
    });

    // Note: 循環依存を回避するため、auth-backendのデプロイメントへの依存関係は追加しない
    // 代わりに、スタックレベルの依存関係（app.ts）で順序を制御

    // 出力
    const apiUrl = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-url`);
    new cdk.CfnOutput(this, 'HomeUrl', {
      value: apiUrl,
      exportName: `${props.appName}-${props.stage}-home-url`
    });
  }
}