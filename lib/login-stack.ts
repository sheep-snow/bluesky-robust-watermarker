import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { ParamsResourceStack } from './params-resource-stack';
import { ResourcePolicy } from './resource-policy';

export interface LoginStackProps extends cdk.StackProps {
  stage: string;
  appName: string;
  paramsResourceStack: ParamsResourceStack;
}

export class LoginStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LoginStackProps) {
    super(scope, id, props);

    // Lambda実行ロール
    const lambdaRole = new iam.Role(this, 'LoginLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        CognitoAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cognito-idp:AdminGetUser',
                'cognito-idp:AdminInitiateAuth'
              ],
              resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`]
            })
          ]
        })
      }
    });

    // ログイン Lambda関数
    const loginFunction = new lambdaNodejs.NodejsFunction(this, 'LoginFunction', {
      functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'login'),
      entry: 'lambda/login/index.ts',
      handler: 'handler',
      role: lambdaRole,
      ...ResourcePolicy.getLambdaDefaults(props.stage),
      environment: {
        APP_NAME: props.appName,
        USER_POOL_ID: cdk.Fn.importValue(`${props.appName}-${props.stage}-user-pool-id`),
        USER_POOL_CLIENT_ID: cdk.Fn.importValue(`${props.appName}-${props.stage}-user-pool-client-id`),
        DOMAIN_NAME: props.paramsResourceStack.domainName,
        COGNITO_DOMAIN: cdk.Fn.importValue(`${props.appName}-${props.stage}-cognito-domain-url`),
        API_GATEWAY_URL: cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-url`)
      }
    });

    // コールバック処理 Lambda関数
    const callbackFunction = new lambdaNodejs.NodejsFunction(this, 'CallbackFunction', {
      functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'callback'),
      entry: 'lambda/login/callback.ts',
      handler: 'handler',
      role: lambdaRole,
      ...ResourcePolicy.getLambdaDefaults(props.stage),
      environment: {
        APP_NAME: props.appName,
        DOMAIN_NAME: props.paramsResourceStack.domainName,
        API_GATEWAY_URL: cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-url`),
        COGNITO_DOMAIN: cdk.Fn.importValue(`${props.appName}-${props.stage}-cognito-domain-url`),
        USER_POOL_CLIENT_ID: cdk.Fn.importValue(`${props.appName}-${props.stage}-user-pool-client-id`)
      }
    });

    // API Gateway統合 - Low-levelリソースを使用
    const apiId = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-id`);
    const rootResourceId = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-root-resource-id`);

    // loginリソースを作成
    const loginResource = new apigateway.CfnResource(this, 'LoginResource', {
      restApiId: apiId,
      parentId: rootResourceId,
      pathPart: 'login'
    });

    // callbackリソースを作成
    const callbackResource = new apigateway.CfnResource(this, 'CallbackResource', {
      restApiId: apiId,
      parentId: rootResourceId,
      pathPart: 'callback'
    });

    // Lambda統合のURI
    const loginIntegrationUri = `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${loginFunction.functionArn}/invocations`;
    const callbackIntegrationUri = `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${callbackFunction.functionArn}/invocations`;

    // loginメソッドを作成
    const loginMethod = new apigateway.CfnMethod(this, 'LoginMethod', {
      restApiId: apiId,
      resourceId: loginResource.ref,
      httpMethod: 'GET',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: loginIntegrationUri
      }
    });

    // callbackメソッドを作成
    const callbackMethod = new apigateway.CfnMethod(this, 'CallbackMethod', {
      restApiId: apiId,
      resourceId: callbackResource.ref,
      httpMethod: 'GET',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: callbackIntegrationUri
      }
    });

    // API Gateway Deploymentでprodステージに変更を反映
    const deployment = new apigateway.CfnDeployment(this, 'LoginApiDeployment', {
      restApiId: apiId,
      stageName: 'prod',
      description: `Deploy login/callback endpoint changes to prod stage - ${new Date().toISOString()}`
    });

    // リソースとメソッド作成後にデプロイメントを実行
    deployment.addDependency(loginResource);
    deployment.addDependency(callbackResource);
    deployment.addDependency(loginMethod);
    deployment.addDependency(callbackMethod);

    // Lambda実行権限を追加
    loginFunction.addPermission('AllowApiGatewayInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${apiId}/*/*`
    });

    callbackFunction.addPermission('AllowApiGatewayInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${apiId}/*/*`
    });

    // Note: 循環依存を回避するため、auth-backendのデプロイメントへの依存関係は追加しない
    // 代わりに、スタックレベルの依存関係（app.ts）で順序を制御

    // 出力
    const apiUrl = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-url`);
    new cdk.CfnOutput(this, 'LoginUrl', {
      value: `${apiUrl}login`,
      exportName: `${props.appName}-${props.stage}-login-url`
    });
  }
}