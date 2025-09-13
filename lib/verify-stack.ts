import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { ParamsResourceStack } from './params-resource-stack';
import { ResourcePolicy } from './resource-policy';

export interface VerifyStackProps extends cdk.StackProps {
    stage: string;
    appName: string;
    paramsResourceStack: ParamsResourceStack;
}export class VerifyStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: VerifyStackProps) {
        super(scope, id, props);

        // 透かし検証用のLambda関数ロール（S3読み込みのみ）
        const verifyRole = new iam.Role(this, 'VerifyRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
            ],
            inlinePolicies: {
                S3ReadOnlyAccess: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: ['s3:GetObject'],
                            resources: [
                                `${props.paramsResourceStack.provenanceInfoBucket.bucketArn}/*`,
                                `${props.paramsResourceStack.provenancePublicBucket.bucketArn}/*`
                            ]
                        })
                    ]
                })
            }
        });

        // 透かし検証Lambda関数（Python版、public endpoint）
        const verifyFunction = new lambda.DockerImageFunction(this, 'VerifyFunction', {
            functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'verify'),
            code: lambda.DockerImageCode.fromImageAsset('.', {
                cmd: ['lambda.verify_watermark.handler.handler'],
                file: 'Dockerfile'
            }),
            role: verifyRole,
            ...ResourcePolicy.getLambdaDefaults(props.stage),
            timeout: cdk.Duration.minutes(5),
            memorySize: 2048,
            retryAttempts: 0,
            environment: {
                APP_NAME: props.appName,
                PROVENANCE_BUCKET: props.paramsResourceStack.provenanceInfoBucket.bucketName,
                PROVENANCE_PUBLIC_BUCKET: props.paramsResourceStack.provenancePublicBucket.bucketName,
                STAGE: props.stage
            }
        });

        // API Gateway統合 - Low-levelリソースを使用
        const apiId = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-id`);
        const rootResourceId = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-root-resource-id`);

        // verifyリソースを作成
        const verifyResource = new apigateway.CfnResource(this, 'VerifyResource', {
            restApiId: apiId,
            parentId: rootResourceId,
            pathPart: 'verify'
        });

        // Lambda統合のURI
        const lambdaIntegrationUri = `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${verifyFunction.functionArn}/invocations`;

        // API Gateway メソッドを直接作成
        const verifyMethod = new apigateway.CfnMethod(this, 'VerifyMethod', {
            restApiId: apiId,
            resourceId: verifyResource.ref,
            httpMethod: 'POST',
            authorizationType: 'NONE',
            integration: {
                type: 'AWS_PROXY',
                integrationHttpMethod: 'POST',
                uri: lambdaIntegrationUri
            }
        });

        // API Gateway Deploymentでprodステージに変更を反映
        const deployment = new apigateway.CfnDeployment(this, 'VerifyApiDeployment', {
            restApiId: apiId,
            stageName: 'prod',
            description: `Deploy verify endpoint changes to prod stage - ${new Date().toISOString()}`
        });

        // リソースとメソッド作成後にデプロイメントを実行
        deployment.addDependency(verifyResource);
        deployment.addDependency(verifyMethod);

        // Lambda実行権限を追加
        verifyFunction.addPermission('AllowApiGatewayInvoke', {
            principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
            sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${apiId}/*/*`
        });        // 出力
        const apiUrl = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-url`);
        new cdk.CfnOutput(this, 'VerifyUrl', {
            value: `${apiUrl}verify`,
            exportName: `${props.appName}-${props.stage}-verify-url`
        });
    }
}
