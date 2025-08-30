import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { ParamsResourceStack } from './params-resource-stack';
import { ResourcePolicy } from './resource-policy';

export interface VerifyWatermarkStackProps extends cdk.StackProps {
    stage: string;
    appName: string;
    paramsResourceStack: ParamsResourceStack;
}export class VerifyWatermarkStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: VerifyWatermarkStackProps) {
        super(scope, id, props);

        // Lambda実行ロール（S3読み込み権限付き）
        const lambdaRole = new iam.Role(this, 'VerifyWatermarkLambdaRole', {
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
                                's3:GetObject'
                            ],
                            resources: [
                                `${props.paramsResourceStack.provenanceInfoBucket.bucketArn}/*`,
                                `${props.paramsResourceStack.provenancePublicBucket.bucketArn}/*`
                            ]
                        })
                    ]
                })
            }
        });

        // Watermark検証 Lambda関数（Python版、公開機能）
        const verifyWatermarkLogGroup = ResourcePolicy.createLambdaLogGroup(
            this, 'VerifyWatermarkLogGroup',
            ResourcePolicy.getResourceName(props.appName, props.stage, 'verify-watermark'),
            props.stage
        );

        const verifyWatermarkFunction = new lambda.DockerImageFunction(this, 'VerifyWatermarkFunction', {
            functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'verify-watermark'),
            code: lambda.DockerImageCode.fromImageAsset('.', {
                cmd: ['lambda.verify_watermark.handler'],
                file: 'Dockerfile'
            }),
            role: lambdaRole,
            ...ResourcePolicy.getLambdaDefaults(props.stage),
            timeout: cdk.Duration.minutes(5),
            memorySize: 1024,
            logGroup: verifyWatermarkLogGroup,
            environment: {
                APP_NAME: props.appName,
                DOMAIN_NAME: process.env.DOMAIN_NAME || 'brw-example.app',
                PROVENANCE_BUCKET: props.paramsResourceStack.provenanceInfoBucket.bucketName,
                PROVENANCE_PUBLIC_BUCKET: props.paramsResourceStack.provenancePublicBucket.bucketName,
                STAGE: props.stage
            }
        });

        // API Gateway統合
        const api = apigateway.RestApi.fromRestApiAttributes(this, 'ImportedApi', {
            restApiId: cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-id`),
            rootResourceId: cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-root-resource-id`)
        });

        const verifyWatermarkIntegration = new apigateway.LambdaIntegration(verifyWatermarkFunction);

        // Add public watermark verification endpoint (same pattern as home/login)
        const verifyWatermarkResource = api.root.addResource('verify-watermark');
        verifyWatermarkResource.addMethod('GET', verifyWatermarkIntegration);
        verifyWatermarkResource.addMethod('POST', verifyWatermarkIntegration);
        verifyWatermarkResource.addMethod('OPTIONS', verifyWatermarkIntegration);

        // API Gateway再デプロイ
        new apigateway.Deployment(this, 'VerifyWatermarkDeployment', {
            api: api,
            description: `VerifyWatermark deployment ${new Date().toISOString()}`
        });

        // 出力
        const apiUrl = cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-url`);
        new cdk.CfnOutput(this, 'VerifyWatermarkUrl', {
            value: `${apiUrl}verify-watermark`,
            exportName: `${props.appName}-${props.stage}-verify-watermark-url`
        });
    }
}
