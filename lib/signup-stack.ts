import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { ParamsResourceStack } from './params-resource-stack';
import { ResourcePolicy } from './resource-policy';

export interface SignupStackProps extends cdk.StackProps {
  stage: string;
  appName: string;
  paramsResourceStack: ParamsResourceStack;
}

export class SignupStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SignupStackProps) {
    super(scope, id, props);

    // Lambda実行ロール
    const lambdaRole = new iam.Role(this, 'SignupLambdaRole', {
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
                'cognito-idp:AdminCreateUser',
                'cognito-idp:AdminSetUserPassword',
                'cognito-idp:AdminConfirmSignUp'
              ],
              resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`]
            })
          ]
        })
      }
    });

    // サインアップ Lambda関数
    const signupLogGroup = ResourcePolicy.createLambdaLogGroup(
      this, 'SignupFunctionLogGroup',
      ResourcePolicy.getResourceName(props.appName, props.stage, 'signup'),
      props.stage
    );
    const signupFunction = new lambdaNodejs.NodejsFunction(this, 'SignupFunction', {
      functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'signup'),
      entry: 'lambda/signup/index.ts',
      handler: 'handler',
      role: lambdaRole,
      ...ResourcePolicy.getLambdaDefaults(props.stage),
      logGroup: signupLogGroup,
      environment: {
        APP_NAME: props.appName,
        USER_POOL_ID: cdk.Fn.importValue(`${props.appName}-${props.stage}-user-pool-id`),
        USER_POOL_CLIENT_ID: cdk.Fn.importValue(`${props.appName}-${props.stage}-user-pool-client-id`),
        DOMAIN_NAME: props.paramsResourceStack.domainName,
        COGNITO_DOMAIN: cdk.Fn.importValue(`${props.appName}-${props.stage}-cognito-domain-url`),
        API_GATEWAY_URL: cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-url`)
      }
      , retryAttempts: 0
    });

    // API Gateway統合 - Low-levelリソースを使用
    const apiId = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-id`);
    const rootResourceId = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-root-resource-id`);

    // signupリソースを作成
    const signupResource = new apigateway.CfnResource(this, 'SignupResource', {
      restApiId: apiId,
      parentId: rootResourceId,
      pathPart: 'signup'
    });

    // Lambda統合のURI
    const lambdaIntegrationUri = `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${signupFunction.functionArn}/invocations`;

    // API Gateway メソッドを直接作成
    const signupPostMethod = new apigateway.CfnMethod(this, 'SignupPostMethod', {
      restApiId: apiId,
      resourceId: signupResource.ref,
      httpMethod: 'POST',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: lambdaIntegrationUri
      }
    });

    const signupGetMethod = new apigateway.CfnMethod(this, 'SignupGetMethod', {
      restApiId: apiId,
      resourceId: signupResource.ref,
      httpMethod: 'GET',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: lambdaIntegrationUri
      }
    });

    // Lambda実行権限を追加
    signupFunction.addPermission('AllowApiGatewayInvoke', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${apiId}/*/*`
    });

    // Note: 循環依存を回避するため、auth-backendのデプロイメントへの依存関係は追加しない
    // 代わりに、スタックレベルの依存関係（app.ts）で順序を制御

    // 出力
    const apiUrl = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-url`);
    new cdk.CfnOutput(this, 'SignupUrl', {
      value: `${apiUrl}signup`,
      exportName: `${props.appName}-${props.stage}-signup-url`
    });
  }
}