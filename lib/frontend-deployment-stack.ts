import * as cdk from 'aws-cdk-lib';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { FrontendStack } from './frontend-stack';

export interface FrontendDeploymentStackProps extends cdk.StackProps {
  stage: string;
  appName: string;
  frontendStack: FrontendStack;
}

export class FrontendDeploymentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FrontendDeploymentStackProps) {
    super(scope, id, props);

    // S3にフロントエンドファイルをデプロイ
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset('./frontend/dist')],
      destinationBucket: props.frontendStack.frontendBucket,
      distribution: props.frontendStack.distribution,
      distributionPaths: ['/*']
    });
  }
}