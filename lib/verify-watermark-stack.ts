import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
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

        // DynamoDB table for storing verification results
        const verificationResultsTable = new dynamodb.Table(this, 'VerificationResultsTable', {
            tableName: ResourcePolicy.getResourceName(props.appName, props.stage, 'verification-results'),
            partitionKey: {
                name: 'verification_id',
                type: dynamodb.AttributeType.STRING
            },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: props.stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
            timeToLiveAttribute: 'ttl'
        });

        // Lambda実行ロール（S3読み込み・DynamoDB読み書き権限付き）
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
                        }),
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'dynamodb:GetItem',
                                'dynamodb:PutItem',
                                'dynamodb:UpdateItem'
                            ],
                            resources: [verificationResultsTable.tableArn]
                        })
                    ]
                })
            }
        });

        // Watermark検証 Lambda関数（公開機能）
        const verifyWatermarkLogGroup = ResourcePolicy.createLambdaLogGroup(
            this, 'VerifyWatermarkLogGroup',
            ResourcePolicy.getResourceName(props.appName, props.stage, 'verify-watermark'),
            props.stage
        );

        const verifyWatermarkFunction = new lambda.DockerImageFunction(this, 'VerifyWatermarkFunction', {
            functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'verify-watermark'),
            code: lambda.DockerImageCode.fromImageAsset('.', {
                cmd: ['lambda.verify_watermark.handler.handler'],
                file: 'Dockerfile'
            }),
            role: lambdaRole,
            ...ResourcePolicy.getLambdaDefaults(props.stage),
            timeout: cdk.Duration.minutes(5),
            memorySize: 2048,  // Increased memory for better performance
            logGroup: verifyWatermarkLogGroup,
            retryAttempts: 0,
            environment: {
                APP_NAME: props.appName,
                DOMAIN_NAME: process.env.DOMAIN_NAME || 'brw-example.app',
                CLOUDFRONT_DOMAIN: cdk.Fn.importValue(`${props.appName}-dev-cloudfront-domain-name`),
                PROVENANCE_BUCKET: props.paramsResourceStack.provenanceInfoBucket.bucketName,
                PROVENANCE_PUBLIC_BUCKET: props.paramsResourceStack.provenancePublicBucket.bucketName,
                PROVENANCE_PUBLIC_BUCKET_NAME: props.paramsResourceStack.provenancePublicBucket.bucketName,
                STAGE: props.stage,
                VERIFICATION_RESULTS_TABLE: verificationResultsTable.tableName
            }
        });

        // Result checker Lambda function
        const checkResultLogGroup = ResourcePolicy.createLambdaLogGroup(
            this, 'CheckResultLogGroup',
            ResourcePolicy.getResourceName(props.appName, props.stage, 'check-result'),
            props.stage
        );

        const checkResultFunction = new lambda.DockerImageFunction(this, 'CheckResultFunction', {
            functionName: ResourcePolicy.getResourceName(props.appName, props.stage, 'check-result'),
            code: lambda.DockerImageCode.fromImageAsset('.', {
                cmd: ['lambda.check_result.handler.handler'],
                file: 'Dockerfile'
            }),
            role: lambdaRole,
            ...ResourcePolicy.getLambdaDefaults(props.stage),
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            logGroup: checkResultLogGroup,
            retryAttempts: 0,
            environment: {
                APP_NAME: props.appName,
                DOMAIN_NAME: process.env.DOMAIN_NAME || 'brw-example.app',
                CLOUDFRONT_DOMAIN: cdk.Fn.importValue(`${props.appName}-dev-cloudfront-domain-name`),
                STAGE: props.stage,
                VERIFICATION_RESULTS_TABLE: verificationResultsTable.tableName
            }
        });

        // API Gateway統合
        const api = apigateway.RestApi.fromRestApiAttributes(this, 'ImportedApi', {
            restApiId: cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-id`),
            rootResourceId: cdk.Fn.importValue(`${props.appName}-${props.stage}-api-gateway-root-resource-id`)
        });

        const verifyWatermarkIntegration = new apigateway.LambdaIntegration(verifyWatermarkFunction, {
            // Enable binary media type handling
            contentHandling: apigateway.ContentHandling.CONVERT_TO_TEXT
        });

        const checkResultIntegration = new apigateway.LambdaIntegration(checkResultFunction);

        // Add public watermark verification endpoint (same pattern as home/login)
        const verifyWatermarkResource = api.root.addResource('verify-watermark');
        verifyWatermarkResource.addMethod('GET', verifyWatermarkIntegration);
        verifyWatermarkResource.addMethod('POST', verifyWatermarkIntegration);
        verifyWatermarkResource.addMethod('OPTIONS', verifyWatermarkIntegration);

        // Add result checking endpoint
        const checkResultResource = api.root.addResource('check-result');
        checkResultResource.addMethod('GET', checkResultIntegration);
        checkResultResource.addMethod('OPTIONS', checkResultIntegration);

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

        new cdk.CfnOutput(this, 'CheckResultUrl', {
            value: `${apiUrl}check-result`,
            exportName: `${props.appName}-${props.stage}-check-result-url`
        });
    }
}
